import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertGenerationGoldenInventory,
  assertGenerationGoldenPaths,
} from "./generation-golden-paths.mjs";

const confirmationToken = "UPDATE_REVIEWED_GENERATION_GOLDENS";
const categories = new Set([
  "iac",
  "application-source",
  "contracts",
  "manifests",
  "all",
]);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const goldenRoot = path.join(
  repositoryRoot,
  "testdata",
  "generation-goldens-v1",
  "goldens",
);
const inventoryPath = path.join(
  repositoryRoot,
  "testdata",
  "generation-goldens-v1",
  "fixture-inventory.json",
);

function usage(message) {
  if (message !== undefined) console.error(message);
  console.error(
    "Usage: node scripts/update-generation-goldens.mjs --category <iac|application-source|contracts|manifests|all> --confirm UPDATE_REVIEWED_GENERATION_GOLDENS --summary <reviewer-readable change summary>",
  );
  process.exitCode = 2;
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key !== "--category" && key !== "--confirm" && key !== "--summary") {
      usage(`Unknown golden-update argument: ${key ?? "<missing>"}`);
      return undefined;
    }
    const value = values[index + 1];
    if (value === undefined || value.startsWith("--")) {
      usage(`Missing value for ${key}.`);
      return undefined;
    }
    const property = key.slice(2);
    if (Object.hasOwn(result, property)) {
      usage(`Duplicate golden-update argument: ${key}.`);
      return undefined;
    }
    result[property] = value;
    index += 1;
  }
  return result;
}

function run(command, arguments_, environment) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} failed with exit code ${String(result.status)}.`,
    );
  }
}

function runPnpm(arguments_, environment) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath === undefined || npmExecPath.trim() === "") {
    throw new Error(
      "Run the golden updater through pnpm so npm_execpath is pinned.",
    );
  }
  run(process.execPath, [npmExecPath, ...arguments_], environment);
}

function updateCategory(category, summary) {
  const environment = {
    ...process.env,
    CLOUDMARKUP_GENERATION_GOLDEN_CATEGORY: category,
    CLOUDMARKUP_GENERATION_GOLDEN_CONFIRM: confirmationToken,
    CLOUDMARKUP_GENERATION_GOLDEN_SUMMARY: summary,
  };
  if (category === "iac" || category === "manifests") {
    run(
      "go",
      [
        "-C",
        "services/iac-compiler",
        "test",
        ".",
        "-run",
        "^TestGenerationGoldenSuite$",
        "-count=1",
      ],
      environment,
    );
  }
  if (
    category === "application-source" ||
    category === "contracts" ||
    category === "manifests"
  ) {
    runPnpm(
      [
        "exec",
        "vitest",
        "run",
        "--project=application-generator",
        "packages/application-generator/src/generation-conformance.test.ts",
        ...(category === "manifests"
          ? ["packages/application-generator/src/generate.event.test.ts"]
          : []),
      ],
      environment,
    );
  }
}

async function semanticSummaries() {
  const results = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.name === "semantic-summary.md") {
        results.push(
          path.relative(repositoryRoot, target).split(path.sep).join("/"),
        );
      }
    }
  }
  await visit(goldenRoot);
  return results.sort();
}

const arguments_ = parseArguments(process.argv.slice(2));
if (arguments_ !== undefined) {
  const category = arguments_.category;
  const summary = arguments_.summary?.trim();
  if (category === undefined || !categories.has(category)) {
    usage("A supported --category is required.");
  } else if (arguments_.confirm !== confirmationToken) {
    usage("The exact --confirm token is required; no files were updated.");
  } else if (summary === undefined || summary.length < 12) {
    usage(
      "A reviewer-readable --summary of at least 12 characters is required.",
    );
  } else {
    const selected =
      category === "all"
        ? ["iac", "application-source", "contracts", "manifests"]
        : [category];
    for (const selectedCategory of selected) {
      console.info(`Updating generation goldens: ${selectedCategory}`);
      updateCategory(selectedCategory, summary);
    }
    const inspection = await assertGenerationGoldenPaths(
      repositoryRoot,
      goldenRoot,
    );
    const inventoryInspection = await assertGenerationGoldenInventory(
      goldenRoot,
      inventoryPath,
    );
    console.info(
      `Golden path budget: ${String(inspection.maximumPathLength)}/180; ` +
        `filename: ${String(inspection.maximumFilenameLength)}/96.`,
    );
    console.info(
      `Golden inventory: ${String(inventoryInspection.actualFixtureIds.length)} fixtures; ` +
        `${String(inventoryInspection.actualCategories.length)} categories.`,
    );
    const summaries = await semanticSummaries();
    console.info(
      `Reviewed semantic summaries available: ${String(summaries.length)}`,
    );
    for (const summaryPath of summaries) console.info(`- ${summaryPath}`);
  }
}
