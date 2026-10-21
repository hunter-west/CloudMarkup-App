import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative } from "node:path";
import test from "node:test";
import {
  assertCiResults,
  documentationOnlyPullRequest,
  isDocumentationDiff,
  isDocumentationPath,
  impactedTestProjects,
  readVitestProjects,
  selfHostToolingForRevision,
  testProjectsForRevision,
} from "./ci-change-scope.mjs";

const base = "a".repeat(40),
  head = "b".repeat(40);
const record = (path, before = "100644", after = "100644", status = "M") =>
  `:${before} ${after} ${base} ${head} ${status}\0${path}\0`;

test("self-host operator tooling follows exact relevant diffs and refuses uncertain omissions", () => {
  const calls = [];
  const git =
    (bytes, missing = false, checkout = head) =>
    (_command, args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return checkout;
      if (args[0] === "merge-base") {
        if (missing) throw Error("Missing history");
        return Buffer.alloc(0);
      }
      return bytes;
    };
  const input = { event: "pull_request", base, head };
  for (const path of [
    "scripts/self-host/backup.mjs",
    "scripts/self-host/restore.test.mjs",
    "apps/api/migrations/0137_provider_direct_usage_journal_definitions.sql",
    "apps/api/self-host-migrations/manifest.json",
    "apps/api/authorization-proposals/self-host-runtime-acl-v1.sql",
    "apps/api/src/adapters/persistence/migrations.ts",
    "apps/api/src/self-host/migration-profile.ts",
    "apps/api/src/persistence.ts",
    "apps/api/src/self-host-owner.ts",
    "apps/api/package.json",
    "package.json",
    "pnpm-lock.yaml",
    ".node-version",
    ".github/workflows/ci.yml",
    "scripts/ci-change-scope.mjs",
    "scripts/validate-workflows.mjs",
    "scripts/security/static-verifier-core.mjs",
    "services/iac-compiler/go.mod",
  ])
    assert.equal(
      selfHostToolingForRevision(input, git(Buffer.from(record(path)))),
      true,
      path,
    );
  for (const path of [
    "apps/web/src/editor.tsx",
    "packages/domain/src/graph.ts",
    "docs/architecture/SYSTEM_OVERVIEW.md",
  ])
    assert.equal(
      selfHostToolingForRevision(input, git(Buffer.from(record(path)))),
      false,
      path,
    );
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from(
      record("scripts/self-host/backup.mjs", "100644", "000000", "D"),
    ),
    Buffer.from(
      record("scripts/self-host/backup.mjs", "000000", "100644", "A"),
    ),
    // --no-renames represents movement as a deletion and addition.
    Buffer.from(
      record("scripts/self-host/old.mjs", "100644", "000000", "D") +
        record("scripts/new.mjs", "000000", "100644", "A"),
    ),
    Buffer.from(record("apps/web/src/a.ts").slice(0, -1)),
    Buffer.from(record("apps/web/src/a.ts", "100644", "120000", "T")),
    Buffer.from("malformed\0"),
    Buffer.from([255, 0]),
  ])
    assert.equal(selfHostToolingForRevision(input, git(bytes)), true);
  assert.equal(
    selfHostToolingForRevision(
      input,
      git(Buffer.from(record("apps/web/src/a.ts")), true),
    ),
    true,
  );
  assert.equal(
    selfHostToolingForRevision(
      input,
      git(Buffer.from(record("apps/web/src/a.ts")), false, base),
    ),
    true,
  );
  assert.equal(
    selfHostToolingForRevision({ ...input, event: "schedule" }, () =>
      assert.fail(),
    ),
    true,
  );
  assert.equal(
    selfHostToolingForRevision({ ...input, base: "unknown" }, () =>
      assert.fail(),
    ),
    true,
  );
  assert.equal(
    selfHostToolingForRevision({ ...input, functionalBeta: true }, () =>
      assert.fail(),
    ),
    true,
  );
  assert.throws(() =>
    selfHostToolingForRevision({ ...input, functionalBeta: "false" }, () =>
      assert.fail(),
    ),
  );
  assert.deepEqual(
    calls.find((args) => args[0] === "diff"),
    ["diff", "--raw", "--no-abbrev", "--no-renames", "-z", base, head],
  );
});

test("documentation scope admits only ordinary contributor Markdown paths", () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "BETA_READINESS.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "AGENTS.md",
    "packages/domain/README.md",
    "apps/web/AGENTS.md",
    "services/iac-compiler/README.md",
    "infra/platform/README.md",
    "evals/README.md",
    "scripts/README.md",
    "docs/architecture/TESTING_STRATEGY.md",
  ])
    assert.equal(isDocumentationPath(path), true, path);
  for (const path of [
    "docs/schema.json",
    "docs/example.ts",
    "docs/page.mdx",
    "scripts/check.mjs",
    "package.json",
    ".github/unreviewed.md",
    "SECURITY.md.mjs",
    "pnpm-lock.yaml",
    "fixtures/output.md",
    "fixtures/README.md",
    "testdata/generation-goldens-v1/goldens/api-gateway-lambda/iac/infrastructure/README.md",
    "packages/application-generator/fixtures/README.md",
    "packages/domain/src/README.md",
    "infra/images/application-build/README.md",
    "infra/images/terraform-validation/README.md",
    "infra/images/go-tools/README.md",
    "services/iac-compiler/testdata/AGENTS.md",
    ".github/workflows/ci.yml",
    "docs/../package.json",
    "docs\\a.md",
    "docs/a.md\n",
  ])
    assert.equal(isDocumentationPath(path), false, path);
  assert.equal(
    isDocumentationDiff(
      Buffer.from(
        record("docs/guide.md") + record("README.md", "000000", "100644", "A"),
      ),
    ),
    true,
  );
  assert.equal(
    isDocumentationDiff(
      Buffer.from(record("docs/guide.md", "100644", "000000", "D")),
    ),
    true,
  );
});

test("mixed changes, executable Markdown, symlinks and uncertain diffs require full verification", () => {
  for (const diff of [
    "",
    record("docs/guide.md") + record("apps/web/src/main.tsx"),
    record("README.md") + record("infra/images/application-build/README.md"),
    record(
      "testdata/generation-goldens-v1/goldens/api-gateway-lambda/iac/infrastructure/README.md",
    ),
    record("README.md", "100644", "120000", "T"),
    record("docs/guide.md", "100644", "100755"),
    record("docs/guide.md").slice(0, -1),
  ])
    assert.equal(isDocumentationDiff(Buffer.from(diff)), false);
  for (const diff of [
    Buffer.from("invalid\0README.md\0"),
    Buffer.from("partial\0"),
    Buffer.from([255, 0]),
  ])
    assert.throws(() => isDocumentationDiff(diff));
});

test("classification uses the complete exact-revision raw diff and fails closed on missing ancestry", () => {
  const calls = [];
  const git = (command, args) => {
    assert.equal(command, "git");
    calls.push(args);
    if (args[0] === "rev-parse") return head + "\n";
    if (args[0] === "merge-base") return Buffer.alloc(0);
    return Buffer.from(record("README.md"));
  };
  assert.equal(
    documentationOnlyPullRequest({ event: "pull_request", base, head }, git),
    true,
  );
  assert.deepEqual(calls.at(-1), [
    "diff",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    "-z",
    base,
    head,
  ]);
  for (const event of [
    "push",
    "schedule",
    "workflow_dispatch",
    "workflow_call",
  ])
    assert.equal(
      documentationOnlyPullRequest({ event, base, head }, () => assert.fail()),
      false,
    );
  assert.equal(
    documentationOnlyPullRequest(
      { event: "pull_request", base: "missing", head },
      () => assert.fail(),
    ),
    false,
  );
  assert.equal(
    documentationOnlyPullRequest(
      { event: "pull_request", base, head },
      (_command, args) => {
        if (args[0] === "rev-parse") return head;
        throw Error("missing ancestor");
      },
    ),
    false,
  );
  assert.throws(
    () =>
      documentationOnlyPullRequest(
        { event: "pull_request", base, head },
        () => base,
      ),
    /Checkout/u,
  );
});

function testWorkspace() {
  const packageOf = (root, dependencies = {}) => ({
    root,
    manifest: { name: `@fixture/${root.split("/").at(-1)}`, dependencies },
  });
  return {
    packages: [
      packageOf("packages/core"),
      packageOf("packages/fixtures"),
      packageOf("packages/ui", { "@fixture/core": "workspace:*" }),
      packageOf("apps/web", {
        "@fixture/ui": "workspace:*",
        "@fixture/fixtures": "workspace:*",
      }),
      packageOf("apps/api", { "@fixture/core": "workspace:*" }),
      packageOf("infra/platform"),
    ],
    projects: [
      { name: "contracts", includes: ["packages/core/src/**/*.test.ts"] },
      { name: "ui", includes: ["packages/ui/src/**/*.test.{ts,tsx}"] },
      { name: "web", includes: ["apps/web/src/**/*.test.{ts,tsx}"] },
      { name: "api", includes: ["apps/api/src/**/*.test.ts"] },
      { name: "platform", includes: ["infra/platform/test/**/*.test.ts"] },
    ],
    files: [
      "packages/core/src/core.test.ts",
      "packages/ui/src/ui.test.tsx",
      "apps/web/src/web.test.tsx",
      "apps/api/src/api.test.ts",
      "infra/platform/test/stage.test.ts",
    ],
  };
}

test("impacted tests select changed packages and reverse transitive workspace dependents", () => {
  const workspace = testWorkspace();
  const select = (...paths) =>
    impactedTestProjects(
      Buffer.from(paths.map((path) => record(path)).join("")),
      workspace,
    );
  assert.deepEqual(select("apps/web/src/view.tsx"), ["web"]);
  assert.deepEqual(select("packages/ui/src/button.tsx"), ["ui", "web"]);
  assert.deepEqual(select("packages/core/src/model.ts"), [
    "api",
    "contracts",
    "ui",
    "web",
  ]);
  assert.deepEqual(
    select("infra/platform/lib/stage.ts", "apps/web/src/view.tsx"),
    ["platform", "web"],
  );
  assert.deepEqual(select("packages/fixtures/fixtures/example.json"), ["web"]);
  assert.deepEqual(select("docs/guide.md", "apps/web/src/view.tsx"), ["web"]);
  for (const field of [
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const alternate = testWorkspace();
    alternate.packages[3].manifest.dependencies = {};
    alternate.packages[3].manifest[field] = {
      "@fixture/fixtures": "workspace:*",
    };
    assert.deepEqual(
      impactedTestProjects(
        Buffer.from(record("packages/fixtures/src/example.ts")),
        alternate,
      ),
      ["web"],
    );
  }
  workspace.packages[0].manifest.dependencies = {
    "@fixture/ui": "workspace:*",
  };
  assert.deepEqual(select("packages/core/src/model.ts"), [
    "api",
    "contracts",
    "ui",
    "web",
  ]);
});

test("critical data paths require all tests beyond their declared API consumers", () => {
  const workspace = testWorkspace();
  workspace.packages[5].manifest.dependencies = {
    "@fixture/api": "workspace:*",
  };
  const select = (path) =>
    impactedTestProjects(Buffer.from(record(path)), workspace);

  assert.deepEqual(select("apps/api/src/application/project-summary.ts"), [
    "api",
    "platform",
  ]);
  for (const path of [
    "apps/api/src/adapters/persistence/async-job-repository.ts",
    "apps/api/src/adapters/persistence/async-job-repository-codec.ts",
    "apps/api/src/database/connection.ts",
    "apps/api/src/data/project-record.ts",
    "apps/api/src/schema.ts",
    "apps/api/src/schemas/project.ts",
  ])
    assert.deepEqual(select(path), [], path);
});

test("unknown scope, shared controls, security controls and malformed diffs require all tests", () => {
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "vitest.config.ts",
    ".github/workflows/ci.yml",
    "scripts/check.mjs",
    "unknown/file.ts",
    "services/iac-compiler/main.go",
    "packages/new-package/src/model.ts",
    "apps/web/package.json",
    "apps/web/tsconfig.json",
    "apps/web/vite.config.ts",
    "apps/web/scripts/generate.mjs",
    "apps/web/generate.mjs",
    "apps/web/.npmrc",
    "apps/web/package-lock.json",
    "packages/core/AGENTS.md",
    "SECURITY.md",
    "apps/api/src/tenant-access.ts",
    "apps/web/src/features/billing/view.tsx",
    "apps/api/src/identity/login.ts",
    "apps/api/src/account-authentication.ts",
    "apps/api/src/gitlab-oauth.ts",
    "apps/api/src/account-sessions.ts",
    "apps/api/src/payment-period.ts",
    "apps/api/src/recovery.ts",
    "apps/api/src/migrations/001.sql",
    "packages/core/src/security.ts",
    "apps/web/src/credentials.ts",
    "apps/web/src/secrets.ts",
    "apps/web/src/../other.ts",
    "apps/web/src/view.tsx\n",
  ])
    assert.deepEqual(
      impactedTestProjects(Buffer.from(record(path)), testWorkspace()),
      [],
      path,
    );
  for (const diff of [
    "",
    record("docs/guide.md"),
    record("apps/web/src/a.ts").slice(0, -1),
    record("apps/web/src/a.ts", "100644", "120000", "T"),
    record("apps/web/src/a.ts", "100644", "100755"),
    record("apps/web/src/a.ts") + record("unknown/file.ts"),
  ])
    assert.deepEqual(
      impactedTestProjects(Buffer.from(diff), testWorkspace()),
      [],
    );
  for (const bytes of [
    Buffer.from([255, 0]),
    Buffer.from("bad\0path\0"),
    Buffer.from("partial\0"),
  ])
    assert.throws(() => impactedTestProjects(bytes, testWorkspace()));
});

test("test selection cannot turn missing tests or an incomplete workspace graph into success", () => {
  const diff = Buffer.from(record("packages/ui/src/button.tsx"));
  const mutations = [
    (workspace) => {
      workspace.files = workspace.files.filter(
        (path) => !path.startsWith("packages/ui/"),
      );
    },
    (workspace) => {
      workspace.files.push("packages/ui/test/unconfigured.test.ts");
    },
    (workspace) => {
      workspace.packages[0].manifest.dependencies = {
        "@fixture/missing": "workspace:*",
      };
    },
    (workspace) => {
      workspace.packages.push(workspace.packages[0]);
    },
    (workspace) => {
      workspace.packages[0].manifest.dependencies = null;
      workspace.packages[1].manifest.dependencies = [];
    },
    (workspace) => {
      workspace.packages[0].manifest.dependencies = { invalid: null };
    },
  ];
  for (const mutate of mutations) {
    const workspace = testWorkspace();
    mutate(workspace);
    assert.deepEqual(impactedTestProjects(diff, workspace), []);
  }
  const orphan = testWorkspace();
  orphan.packages.push({
    root: "packages/orphan",
    manifest: { name: "@fixture/orphan" },
  });
  assert.deepEqual(
    impactedTestProjects(
      Buffer.from(record("packages/orphan/src/model.ts")),
      orphan,
    ),
    [],
  );
});

test("Vitest project mapping uses configured roots and includes, with unknown forms failing closed", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("vitest.config.ts", "utf8");
  const projects = readVitestProjects(source);
  assert.equal(
    projects.find(({ name }) => name === "web").includes[0],
    "apps/web/src/**/*.test.{ts,tsx}",
  );
  assert.ok(
    projects
      .find(({ name }) => name === "contracts")
      .includes.includes("packages/domain/src/**/*.test.ts"),
  );
  for (const altered of [
    source.replace('name: "web",', "name: computedName,"),
    source.replace('name: "web",', 'name: "web", name: "api",'),
    source.replace(
      'name: "web",',
      'name: "web", exclude: ["src/critical.test.ts"],',
    ),
    source.replace('"./apps/web"', '"./unknown/web"'),
    source.replace('"src/**/*.test.{ts,tsx}"', '"src/*.test.ts"'),
    source.replace(
      "root: repositoryRoot,\n        },",
      "root: unknownRoot,\n        },",
    ),
  ])
    assert.throws(() => readVitestProjects(altered));
});

test("revision selection reads the complete exact diff and exact-source workspace for PRs and main pushes", () => {
  const calls = [];
  const workspace = testWorkspace();
  const config =
    'projects: [{ extends: true, test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"], name: "web", root: fileURLToPath(new URL("./apps/web", import.meta.url)), }, }], restoreMocks: true';
  assert.deepEqual(readVitestProjects(config), [
    { name: "web", includes: ["apps/web/src/**/*.test.{ts,tsx}"] },
  ]);
  const git = (_command, args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return head;
    if (args[0] === "merge-base") return Buffer.alloc(0);
    if (args[0] === "diff") return Buffer.from(record("apps/web/src/view.tsx"));
    if (args[0] === "ls-tree")
      return Buffer.from(
        [
          ...workspace.packages.map(({ root }) => `${root}/package.json`),
          ...workspace.files,
          "apps/web/src/view.test.ts",
        ].join("\0") + "\0",
      );
    assert.equal(args[0], "show");
    const path = args[1].slice(41);
    if (path === "pnpm-workspace.yaml")
      return 'packages:\n  - "apps/*"\n  - "packages/*"\n  - "infra/*"\n';
    if (path === "vitest.config.ts") return config;
    return JSON.stringify(
      workspace.packages.find(({ root }) => path === `${root}/package.json`)
        .manifest,
    );
  };
  for (const event of ["pull_request", "push"]) {
    assert.deepEqual(testProjectsForRevision({ event, base, head }, git), [
      "web",
    ]);
    assert.ok(
      calls.some(
        (args) =>
          JSON.stringify(args) ===
          JSON.stringify([
            "diff",
            "--raw",
            "--no-abbrev",
            "--no-renames",
            "-z",
            base,
            head,
          ]),
      ),
    );
    assert.ok(
      calls.some(
        (args) => args[0] === "show" && args[1] === `${head}:vitest.config.ts`,
      ),
    );
  }
  for (const event of [
    "schedule",
    "workflow_dispatch",
    "workflow_call",
    undefined,
  ])
    assert.deepEqual(
      testProjectsForRevision({ event, base, head }, () => assert.fail()),
      [],
    );
  for (const invalidBase of [undefined, "missing", "0".repeat(40)])
    assert.deepEqual(
      testProjectsForRevision({ event: "push", base: invalidBase, head }, () =>
        assert.fail(),
      ),
      [],
    );
  assert.deepEqual(
    testProjectsForRevision({ event: "push", base, head }, (_command, args) => {
      if (args[0] === "rev-parse") return head;
      throw Error("missing ancestry or workspace");
    }),
    [],
  );
  assert.throws(
    () => testProjectsForRevision({ event: "push", base, head }, () => base),
    /Checkout/u,
  );
});

test("committed workspace project selection matches real web and UI dependency boundaries", () => {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  for (const [path, expected] of [
    ["apps/web/src/main.tsx", ["web"]],
    ["packages/ui/src/index.ts", ["ui", "web"]],
  ]) {
    const git = (command, args, options) => {
      if (args[0] === "merge-base") return Buffer.alloc(0);
      if (args[0] === "diff") return Buffer.from(record(path));
      return execFileSync(command, args, options);
    };
    assert.deepEqual(
      testProjectsForRevision({ event: "push", base, head: revision }, git),
      expected,
    );
  }
});

test("functional beta requires full tests while retaining exact checkout binding", () => {
  const candidate = { event: "push", base, head, functionalBeta: true };
  assert.deepEqual(
    testProjectsForRevision(candidate, (_command, args) => {
      assert.deepEqual(args, ["rev-parse", "HEAD"]);
      return head;
    }),
    [],
  );
  assert.throws(() => testProjectsForRevision(candidate, () => base));
  assert.throws(() =>
    testProjectsForRevision({ ...candidate, functionalBeta: "true" }),
  );
});

test("real Git and CLI preserve full beta scope after a failed release and test-only correction", async () => {
  const { readFile } = await import("node:fs/promises");
  const directory = await mkdtemp(
    resolve(tmpdir(), "cloudmarkup-test-projects-"),
  );
  const git = (args) =>
    execFileSync("git", ["-c", "core.hooksPath=disabled-hooks", ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const commit = () => {
    git(["add", "--all"]);
    git([
      "-c",
      "user.name=CI fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "synthetic fixture",
    ]);
    return git(["rev-parse", "HEAD"]).trim();
  };
  try {
    git(["init", "--quiet"]);
    await mkdir(resolve(directory, "apps/web/src"), { recursive: true });
    await writeFile(
      resolve(directory, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n',
    );
    await writeFile(
      resolve(directory, "apps/web/package.json"),
      JSON.stringify({ name: "@fixture/web" }),
    );
    await writeFile(
      resolve(directory, "vitest.config.ts"),
      'projects: [{ extends: true, test: { include: ["src/**/*.test.ts"], name: "web", root: fileURLToPath(new URL("./apps/web", import.meta.url)), }, }], restoreMocks: true',
    );
    await writeFile(
      resolve(directory, "apps/web/src/view.test.ts"),
      "// Synthetic test\n",
    );
    await writeFile(
      resolve(directory, "apps/web/src/view.ts"),
      "export const view = 1;\n",
    );
    const baseRevision = commit();
    await writeFile(
      resolve(directory, "apps/web/src/view.ts"),
      "export const view = 2;\n",
    );
    const headRevision = commit();
    const output = resolve(directory, "output");
    execFileSync(process.execPath, [resolve("scripts/ci-change-scope.mjs")], {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        BASE_SHA: baseRevision,
        GITHUB_SHA: headRevision,
        GITHUB_OUTPUT: output,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(
      await readFile(output, "utf8"),
      'documentation-only=false\ntest-projects=["web"]\nself-host-tooling=false\n',
    );
    await writeFile(output, "");
    execFileSync(process.execPath, [resolve("scripts/ci-change-scope.mjs")], {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "workflow_dispatch",
        BASE_SHA: baseRevision,
        GITHUB_SHA: headRevision,
        GITHUB_OUTPUT: output,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(
      await readFile(output, "utf8"),
      "documentation-only=false\ntest-projects=[]\nself-host-tooling=true\n",
    );
    const select = (baseRevision, headRevision) =>
      testProjectsForRevision(
        { event: "push", base: baseRevision, head: headRevision },
        (command, args, options) =>
          execFileSync(command, args, { ...options, cwd: directory }),
      );
    assert.deepEqual(select(baseRevision, headRevision), ["web"]);
    await writeFile(
      resolve(directory, "apps/web/package.json"),
      JSON.stringify({
        name: "@fixture/web",
        dependencies: { external: "1.0.0" },
      }),
    );
    const manifestRevision = commit();
    assert.deepEqual(select(headRevision, manifestRevision), []);

    // A failed release can cancel backend shards before a web-test-only fix.
    // The next push must still verify the whole pending candidate in beta mode.
    const incompleteRelease = results(false);
    incompleteRelease.tests.result = "cancelled";
    assert.throws(() => assertCiResults(incompleteRelease, "false"));
    await writeFile(
      resolve(directory, "apps/web/src/view.test.ts"),
      "// Correct a stale synthetic expectation\n",
    );
    const correctiveRevision = commit();
    assert.deepEqual(select(manifestRevision, correctiveRevision), ["web"]);
    assert.deepEqual(select(headRevision, correctiveRevision), []);
    for (const functionalBeta of ["false", "true"]) {
      await writeFile(output, "");
      execFileSync(process.execPath, [resolve("scripts/ci-change-scope.mjs")], {
        cwd: directory,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "push",
          BASE_SHA: manifestRevision,
          GITHUB_SHA: correctiveRevision,
          GITHUB_OUTPUT: output,
          CLOUDMARKUP_FUNCTIONAL_BETA: functionalBeta,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.equal(
        await readFile(output, "utf8"),
        functionalBeta === "true"
          ? "documentation-only=false\ntest-projects=[]\nself-host-tooling=true\n"
          : 'documentation-only=false\ntest-projects=["web"]\nself-host-tooling=false\n',
      );
    }

    await writeFile(resolve(directory, "README.md"), "# Corrective handoff\n");
    const documentationRevision = commit();
    for (const functionalBeta of ["false", "true"]) {
      await writeFile(output, "");
      execFileSync(process.execPath, [resolve("scripts/ci-change-scope.mjs")], {
        cwd: directory,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "pull_request",
          BASE_SHA: correctiveRevision,
          GITHUB_SHA: documentationRevision,
          GITHUB_OUTPUT: output,
          CLOUDMARKUP_FUNCTIONAL_BETA: functionalBeta,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.equal(
        await readFile(output, "utf8"),
        `documentation-only=${functionalBeta === "false"}\ntest-projects=[]\nself-host-tooling=${functionalBeta === "true"}\n`,
      );
    }
  } finally {
    assert.ok(!relative(resolve(tmpdir()), directory).startsWith(".."));
    await rm(directory, { recursive: true, force: true });
  }
});

function results(documentationOnly) {
  return Object.fromEntries(
    [
      "browser",
      "build",
      "changes",
      "documentation",
      "lint",
      "quality",
      "security",
      "tests",
    ].map((name) => [
      name,
      {
        result:
          name === "changes" ||
          name === "security" ||
          (documentationOnly
            ? name === "documentation"
            : name !== "documentation")
            ? "success"
            : "skipped",
        ...(name === "changes"
          ? { outputs: { "documentation-only": String(documentationOnly) } }
          : {}),
      },
    ]),
  );
}

test("the final gate requires the complete selected profile and rejects failed, missing or cancelled evidence", () => {
  for (const documentationOnly of [true, false]) {
    const valid = results(documentationOnly);
    assert.doesNotThrow(() => assertCiResults(valid, "false"));
    for (const name of Object.keys(valid)) {
      for (const result of ["failure", "cancelled", "skipped", "success"]) {
        if (result === valid[name].result) continue;
        const invalid = structuredClone(valid);
        invalid[name].result = result;
        assert.throws(
          () => assertCiResults(invalid, "false"),
          name + ": " + result,
        );
      }
      const missing = Object.fromEntries(
        Object.entries(valid).filter(([key]) => key !== name),
      );
      assert.throws(() => assertCiResults(missing, "false"));
    }
    const unknown = structuredClone(valid);
    delete unknown.changes.outputs;
    assert.throws(() => assertCiResults(unknown, "false"));
  }

  const skipped = Object.fromEntries(
    Object.keys(results(false)).map((name) => [name, { result: "skipped" }]),
  );
  assert.throws(() => assertCiResults(skipped, "false"));
});

test("actual Git history preserves Markdown additions, deletions and executable rename boundaries", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cloudmarkup-ci-scope-"));
  const git = (args) =>
    execFileSync("git", ["-c", "core.hooksPath=disabled-hooks", ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const commit = () => {
    git(["add", "--all"]);
    git([
      "-c",
      "user.name=CI fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "synthetic fixture",
    ]);
    return git(["rev-parse", "HEAD"]).trim();
  };
  const classify = (baseRevision) =>
    documentationOnlyPullRequest(
      {
        event: "pull_request",
        base: baseRevision,
        head: git(["rev-parse", "HEAD"]).trim(),
      },
      (command, args, options) =>
        execFileSync(command, args, { ...options, cwd: directory }),
    );
  try {
    git(["init", "--quiet"]);
    await writeFile(resolve(directory, "README.md"), "# Synthetic fixture\n");
    const initial = commit();
    await mkdir(resolve(directory, "docs"));
    await writeFile(
      resolve(directory, "docs/guide with spaces.md"),
      "# Guide\n",
    );
    const added = commit();
    assert.equal(classify(initial), true);
    await rm(resolve(directory, "docs/guide with spaces.md"));
    commit();
    assert.equal(classify(added), true);
    await rename(
      resolve(directory, "README.md"),
      resolve(directory, "runtime.mjs"),
    );
    commit();
    assert.equal(classify(initial), false);
    assert.equal(classify(git(["rev-parse", "HEAD"]).trim()), false);
  } finally {
    assert.ok(!relative(resolve(tmpdir()), directory).startsWith(".."));
    await rm(directory, { recursive: true, force: true });
  }
});

test("draft and unknown review states cannot supply merge admission", () => {
  for (const draft of [
    undefined,
    "true",
    "null",
    '""',
    '"false"',
    "unknown",
    "",
    true,
    false,
    null,
  ])
    for (const documentationOnly of [true, false])
      assert.throws(
        () => assertCiResults(results(documentationOnly), draft),
        /not merge verification/u,
      );
});

test("draft cost guards preserve ready events and the dependency-free failing admission job", async () => {
  const { readFileSync } = await import("node:fs");
  const { parse } = await import("yaml");
  const { assertPullRequestQualityGate } =
    await import("./validate-workflows.mjs");
  const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  assert.doesNotThrow(() => assertPullRequestQualityGate(workflow, "ci.yml"));

  for (const name of Object.keys(workflow.jobs).filter(
    (name) => name !== "gate",
  )) {
    for (const guard of [
      undefined,
      "true",
      "github.event_name != 'pull_request'",
    ]) {
      const altered = structuredClone(workflow);
      if (guard === undefined) delete altered.jobs[name].if;
      else altered.jobs[name].if = guard;
      assert.throws(
        () => assertPullRequestQualityGate(altered, "ci.yml"),
        name,
      );
    }
  }
  for (const event of ["ready_for_review", "converted_to_draft"]) {
    const altered = structuredClone(workflow);
    altered.on.pull_request.types = altered.on.pull_request.types.filter(
      (type) => type !== event,
    );
    assert.throws(() => assertPullRequestQualityGate(altered, "ci.yml"), event);
  }
  const skippedGate = structuredClone(workflow);
  skippedGate.jobs.gate.if =
    "toJSON(github.event.pull_request.draft) == 'false'";
  assert.throws(() => assertPullRequestQualityGate(skippedGate, "ci.yml"));
  const coercedState = structuredClone(workflow);
  coercedState.jobs.gate.steps[1].env.PULL_REQUEST_DRAFT = "false";
  assert.throws(() => assertPullRequestQualityGate(coercedState, "ci.yml"));

  assert.equal(
    workflow.jobs.gate.steps[1].run,
    "node scripts/ci-change-scope.mjs gate",
  );
  assert.equal(
    workflow.jobs.gate.steps
      .slice(0, 2)
      .some((step) => /pnpm|npm install/u.test(step.run ?? "")),
    false,
  );
});

test("quality build reuse rejects cross-run, skipped and unordered cache admission", async () => {
  const { readFileSync } = await import("node:fs");
  const { parse } = await import("yaml");
  const { assertPullRequestQualityGate } =
    await import("./validate-workflows.mjs");
  const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  assert.doesNotThrow(() => assertPullRequestQualityGate(workflow, "ci.yml"));
  const restore = (job) =>
    job.steps.find(
      (step) => step.name === "Restore only this run's build cache",
    );
  const materialize = (job) =>
    job.steps.find(
      (step) => step.name === "Materialize this run's production build outputs",
    );
  const mutations = [
    (job) => {
      job.steps.splice(
        job.steps.findIndex(
          (step) => step.name === "Verify affected self-host operator tooling",
        ),
        1,
      );
    },
    (job) => {
      job.steps.find(
        (step) => step.name === "Verify affected self-host operator tooling",
      ).if = "false";
    },
    (job) => {
      job.steps.find(
        (step) => step.name === "Verify affected self-host operator tooling",
      ).run = "node --test scripts/self-host/backup.test.mjs";
    },
    (job) => {
      job.steps.splice(0, 0, structuredClone(materialize(job)));
    },
    (job) => {
      job.steps.splice(job.steps.indexOf(materialize(job)), 1);
    },
    (job) => {
      materialize(job).if = "false";
    },
    (job) => {
      materialize(job)["continue-on-error"] = true;
    },
    (job) => {
      materialize(job).run =
        "pnpm exec turbo run build --filter='@cloudmarkup/web^...'";
    },
    (job) => {
      const index = job.steps.indexOf(materialize(job));
      [job.steps[index], job.steps[index + 1]] = [
        job.steps[index + 1],
        job.steps[index],
      ];
    },
    (job) => {
      job.steps.splice(
        job.steps.indexOf(restore(job)),
        0,
        structuredClone(restore(job)),
      );
    },
    (job) => {
      job.needs = "changes";
    },
    (job) => {
      restore(job).with["run-id"] = 123;
    },
    (job) => {
      restore(job).with.name = "previous-success";
    },
    (job) => {
      restore(job).with.path = "dist/";
    },
    (job) => {
      restore(job).if = "false";
    },
    (job) => {
      restore(job)["continue-on-error"] = true;
    },
    (job) => {
      job.steps.splice(job.steps.indexOf(restore(job)), 1);
    },
    (job) => {
      const index = job.steps.indexOf(restore(job));
      [job.steps[index], job.steps[index + 1]] = [
        job.steps[index + 1],
        job.steps[index],
      ];
    },
  ];
  for (const mutate of mutations) {
    const altered = structuredClone(workflow);
    mutate(altered.jobs.quality);
    assert.throws(() => assertPullRequestQualityGate(altered, "ci.yml"));
  }
});
