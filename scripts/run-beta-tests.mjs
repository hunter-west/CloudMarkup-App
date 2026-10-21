import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const runtimeFiles = Object.freeze([
  "apps/api/src/production-model-live-execution-postgres.integration.test.ts",
  "apps/api/src/adapters/persistence/model-live-seed-stage-postgres.integration.test.ts",
]);

export function parseImpactedProjects(value = "[]") {
  const projects = JSON.parse(value);
  if (
    !Array.isArray(projects) ||
    new Set(projects).size !== projects.length ||
    projects.some(
      (project) =>
        typeof project !== "string" || !/^[a-z][a-z0-9-]*$/u.test(project),
    )
  )
    throw new Error("Invalid impacted test projects.");
  return projects;
}

export function betaSuiteOptions(projects, coverage = false) {
  return coverage
    ? {}
    : {
        project: projects,
        config: "config/vitest-beta.config.mjs",
      };
}

// Real-time SQL/SDK leases are exercised once, without instrumentation, in
// every admitted beta profile. This includes the retained final-unknown case.
export function betaTestInvocation(mode, args = [], environment = process.env) {
  if (!["suite", "runtime", "coverage"].includes(mode))
    throw new Error("Expected suite, runtime, or coverage profile.");
  if (!environment.CLOUDMARKUP_TEST_DATABASE_URL?.trim())
    throw new Error("Beta tests require an isolated test PostgreSQL database.");
  if (
    args.length > 1 ||
    args.some((arg) => !/^--shard=[1-8]\/8$/u.test(arg)) ||
    (mode === "runtime" && args.length)
  )
    throw new Error("Only one eight-way shard selector is supported.");
  const projects = parseImpactedProjects(environment.CLOUDMARKUP_TEST_PROJECTS);
  const command = [
    "run",
    "--maxWorkers=1",
    "--testTimeout=30000",
    "--hookTimeout=120000",
  ];
  if (mode === "runtime") command.push("--project=api", ...runtimeFiles);
  else if (mode === "suite") {
    const options = betaSuiteOptions(projects);
    command.push(`--config=${options.config}`);
    command.push(...options.project.map((project) => `--project=${project}`));
    // Empty individual shards are expected for a small selected project. The
    // classifier checks that the selected project has tests before admission.
    if (args.length) command.push("--passWithNoTests");
  } else {
    command.push("--coverage", "--reporter=default", "--reporter=blob");
    const shard = args[0]?.match(/^--shard=([1-8])\/8$/u)?.[1];
    if (shard)
      command.push(
        `--outputFile.blob=.cache/vitest-shards/report-${shard}.json`,
      );
  }
  command.push(...args);
  return {
    command,
    env: {
      ...environment,
      npm_lifecycle_event: mode === "coverage" ? "test:coverage" : "test:beta",
      CLOUDMARKUP_TEST_MODEL_COMPOSITION_WITHOUT_COVERAGE: String(
        mode === "coverage",
      ),
      CLOUDMARKUP_TEST_DEFER_EXTENDED_MODEL_ACCOUNTING: String(
        mode === "coverage",
      ),
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { command, env } = betaTestInvocation(
    process.argv[2],
    process.argv.slice(3),
  );
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/vitest/vitest.mjs"), ...command],
    {
      env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
