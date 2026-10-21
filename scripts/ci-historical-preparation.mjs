import { appendFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";
import { betaSuiteOptions, parseImpactedProjects } from "./run-beta-tests.mjs";

export const HISTORICAL_RECEIPT_TEST =
  "apps/api/src/adapters/persistence/model-live-historical-importer-upgrade-postgres.integration.test.ts";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseCiShard(value) {
  if (!/^[1-8]\/8$/u.test(value ?? ""))
    throw new Error("CI preparation requires one exact shard from 1/8 to 8/8.");
  return Number(value[0]);
}

function specificationKey(specification, root) {
  const file = specification?.moduleId;
  const project = specification?.project?.name;
  if (
    typeof file !== "string" ||
    !isAbsolute(file) ||
    typeof project !== "string" ||
    !/^[a-z][a-z0-9-]*$/u.test(project)
  )
    throw new Error("Malformed CI test specification.");
  const local = relative(root, file).replaceAll("\\", "/");
  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local))
    throw new Error("CI test specification escaped the repository.");
  return `${project}:${local}`;
}

export function inspectCiShard(all, selected, root, scoped = false) {
  if (
    !Array.isArray(all) ||
    !Array.isArray(selected) ||
    all.length < (scoped ? 1 : 8) ||
    all.length > 4096 ||
    (!scoped && selected.length === 0)
  )
    throw new Error("CI test discovery must produce a bounded nonempty shard.");
  const allKeys = all.map((spec) => specificationKey(spec, root));
  const keys = selected.map((spec) => specificationKey(spec, root));
  const inventory = new Set(allKeys);
  if (
    inventory.size !== allKeys.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !inventory.has(key))
  )
    throw new Error(
      "CI shard must contain unique discovered test specifications.",
    );
  const historical = `api:${HISTORICAL_RECEIPT_TEST}`;
  if (
    (!scoped && !inventory.has(historical)) ||
    allKeys.filter((key) => key.endsWith(`:${HISTORICAL_RECEIPT_TEST}`))
      .length !== (inventory.has(historical) ? 1 : 0)
  )
    throw new Error("The required historical receipt regression is missing.");
  return {
    totalFiles: all.length,
    selectedFiles: keys.length,
    historicalRequired: keys.includes(historical),
    specifications: keys,
  };
}

/** Discovery only: use the same configured sequencer as Vitest's execution pool.
 * `vitest list --filesOnly --shard` does NOT apply sharding in Vitest 4.1.10. */
export async function planCiHistoricalPreparation(
  shard,
  createContext = createVitest,
  { projects = [], coverage = false } = {},
) {
  const index = parseCiShard(shard);
  const context = await createContext("test", {
    root: repositoryRoot,
    watch: false,
    shard,
    ...betaSuiteOptions(projects, coverage),
  });
  try {
    if (
      context.config.shard?.index !== index ||
      context.config.shard.count !== 8 ||
      resolve(context.config.root) !== repositoryRoot
    )
      throw new Error("Resolved CI shard configuration changed.");
    const all = await context.getRelevantTestSpecifications([]);
    const sequencer = new context.config.sequence.sequencer(context);
    const selected = await sequencer.shard([...all]);
    // A selected project can have fewer than eight files, but its complete
    // inventory must still be nonempty. API/full selection requires the
    // historical regression; unrelated scopes need no historical checkout.
    if (
      (!projects.length || projects.includes("api")) &&
      !all.some(
        (spec) =>
          specificationKey(spec, repositoryRoot) ===
          `api:${HISTORICAL_RECEIPT_TEST}`,
      )
    )
      throw new Error("The required historical receipt regression is missing.");
    return {
      shard,
      ...inspectCiShard(all, selected, repositoryRoot, projects.length > 0),
    };
  } finally {
    await context.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    throw new Error("Expected exactly one CI shard.");
  const coverageValue =
    process.env.CLOUDMARKUP_TEST_COVERAGE_DISCOVERY ?? "false";
  if (!["true", "false"].includes(coverageValue))
    throw new Error("Invalid coverage discovery profile.");
  const result = await planCiHistoricalPreparation(
    process.argv[2],
    createVitest,
    {
      projects:
        coverageValue === "true"
          ? []
          : parseImpactedProjects(process.env.CLOUDMARKUP_TEST_PROJECTS),
      coverage: coverageValue === "true",
    },
  );
  // Emit the decision only after discovery, validation and context cleanup succeed.
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `historical-required=${result.historicalRequired}\n`,
    );
  process.stdout.write(JSON.stringify(result) + "\n");
}
