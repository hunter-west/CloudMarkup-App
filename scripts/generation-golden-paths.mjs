import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import * as path from "node:path";

export const GENERATION_GOLDEN_MAX_REPOSITORY_PATH = 180;
export const GENERATION_GOLDEN_MAX_FILENAME = 96;

const fullDigestInFilename = /[a-f0-9]{64}/iu;
const fixtureIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const windowsAbsolutePattern = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const windowsInvalidComponent = /[<>:"|?*]/u;
const windowsReservedComponent =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const supportedLayers = new Set(["application", "iac"]);
const supportedStatuses = new Set(["metamorphic", "negative", "supported"]);

function compareUtf16(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedEntries(entries) {
  return [...entries].sort((left, right) =>
    compareUtf16(left.name, right.name),
  );
}

function isOutsideRoot(relativePath, pathImplementation) {
  return (
    pathImplementation.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${pathImplementation.sep}`)
  );
}

function hasWindowsInvalidCharacters(value) {
  if (windowsInvalidComponent.test(value)) return true;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function issue(kind, value, limit, filePath, relatedPath) {
  return { filePath, kind, limit, relatedPath, value };
}

function rootLocation(repositoryRoot, goldenRoot) {
  const repositoryIsWindows = windowsAbsolutePattern.test(repositoryRoot);
  const goldenIsWindows = windowsAbsolutePattern.test(goldenRoot);
  if (repositoryIsWindows || goldenIsWindows) {
    if (!repositoryIsWindows || !goldenIsWindows) {
      return {
        goldenRoot: path.resolve(goldenRoot),
        relativePath: goldenRoot,
        repositoryRoot: path.resolve(repositoryRoot),
        unsafe: true,
      };
    }
    const resolvedRepositoryRoot = path.win32.resolve(repositoryRoot);
    const resolvedGoldenRoot = path.win32.resolve(goldenRoot);
    const relativePath = path.win32.relative(
      resolvedRepositoryRoot,
      resolvedGoldenRoot,
    );
    return {
      goldenRoot: resolvedGoldenRoot,
      relativePath,
      repositoryRoot: resolvedRepositoryRoot,
      unsafe: isOutsideRoot(relativePath, path.win32),
    };
  }
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedGoldenRoot = path.resolve(goldenRoot);
  const relativePath = path.relative(
    resolvedRepositoryRoot,
    resolvedGoldenRoot,
  );
  return {
    goldenRoot: resolvedGoldenRoot,
    relativePath,
    repositoryRoot: resolvedRepositoryRoot,
    unsafe: isOutsideRoot(relativePath, path),
  };
}

function relativePathIssues(relativePath, portableOwners) {
  const issues = [];
  const components = relativePath.split("/");
  if (
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    components.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    issues.push(issue("unsafe-path", relativePath.length, 0, relativePath));
  }
  if (
    components.some(
      (component) =>
        hasWindowsInvalidCharacters(component) ||
        windowsReservedComponent.test(component) ||
        /[. ]$/u.test(component),
    )
  ) {
    issues.push(
      issue("windows-invalid-component", relativePath.length, 0, relativePath),
    );
  }
  if (relativePath.length > GENERATION_GOLDEN_MAX_REPOSITORY_PATH) {
    issues.push(
      issue(
        "repository-path-length",
        relativePath.length,
        GENERATION_GOLDEN_MAX_REPOSITORY_PATH,
        relativePath,
      ),
    );
  }
  const filename = path.posix.basename(relativePath);
  if (filename.length > GENERATION_GOLDEN_MAX_FILENAME) {
    issues.push(
      issue(
        "filename-length",
        filename.length,
        GENERATION_GOLDEN_MAX_FILENAME,
        relativePath,
      ),
    );
  }
  if (fullDigestInFilename.test(filename)) {
    issues.push(
      issue("full-digest-filename", filename.length, 0, relativePath),
    );
  }
  const portablePath = relativePath.normalize("NFC").toLowerCase();
  const existing = portableOwners.get(portablePath);
  if (existing === undefined) {
    portableOwners.set(portablePath, relativePath);
  } else {
    issues.push(issue("portable-path-collision", 1, 0, relativePath, existing));
  }
  return issues;
}

function summarizePathInspection(inputFiles, inputIssues) {
  const files = [...inputFiles].sort(compareUtf16);
  const issues = [...inputIssues].sort(
    (left, right) =>
      compareUtf16(left.filePath, right.filePath) ||
      compareUtf16(left.kind, right.kind) ||
      compareUtf16(left.relatedPath ?? "", right.relatedPath ?? "") ||
      left.value - right.value ||
      left.limit - right.limit,
  );
  const byPathLength = [...files].sort(
    (left, right) => right.length - left.length || compareUtf16(left, right),
  );
  const byFilenameLength = [...files].sort((left, right) => {
    const leftName = path.posix.basename(left);
    const rightName = path.posix.basename(right);
    return rightName.length - leftName.length || compareUtf16(left, right);
  });
  return {
    fileCount: files.length,
    files,
    issues,
    maximumFilename: byFilenameLength[0],
    maximumFilenameLength:
      byFilenameLength.length === 0
        ? 0
        : path.posix.basename(byFilenameLength[0]).length,
    maximumPath: byPathLength[0],
    maximumPathLength: byPathLength[0]?.length ?? 0,
  };
}

export function inspectGenerationGoldenRelativePaths(relativePaths) {
  const portableOwners = new Map();
  const files = [...relativePaths].sort(compareUtf16);
  const issues = files.flatMap((relativePath) =>
    relativePathIssues(relativePath, portableOwners),
  );
  return summarizePathInspection(files, issues);
}

export async function inspectGenerationGoldenPaths(repositoryRoot, goldenRoot) {
  const files = [];
  const issues = [];
  let location = rootLocation(repositoryRoot, goldenRoot);
  if (location.unsafe) {
    issues.push(
      issue(
        "unsafe-golden-root",
        location.relativePath.length,
        0,
        location.goldenRoot,
      ),
    );
    return summarizePathInspection(files, issues);
  }
  const [repositoryStat, goldenStat] = await Promise.all([
    lstat(location.repositoryRoot),
    lstat(location.goldenRoot),
  ]);
  if (
    !repositoryStat.isDirectory() ||
    repositoryStat.isSymbolicLink() ||
    !goldenStat.isDirectory() ||
    goldenStat.isSymbolicLink()
  ) {
    issues.push(
      issue("unsafe-golden-root", location.relativePath.length, 0, goldenRoot),
    );
    return summarizePathInspection(files, issues);
  }
  const [realRepositoryRoot, realGoldenRoot] = await Promise.all([
    realpath(location.repositoryRoot),
    realpath(location.goldenRoot),
  ]);
  const realLocation = rootLocation(realRepositoryRoot, realGoldenRoot);
  if (realLocation.unsafe) {
    issues.push(
      issue("unsafe-golden-root", location.relativePath.length, 0, goldenRoot),
    );
    return summarizePathInspection(files, issues);
  }
  location = realLocation;
  const portableOwners = new Map();

  async function visit(directory) {
    const entries = sortedEntries(
      await readdir(directory, { withFileTypes: true }),
    );
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relativePath = path
        .relative(location.repositoryRoot, target)
        .split(path.sep)
        .join("/");
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!entry.isFile()) {
        issues.push(issue("non-regular-file", 1, 0, relativePath));
        continue;
      }

      files.push(relativePath);
      issues.push(...relativePathIssues(relativePath, portableOwners));
    }
  }

  await visit(location.goldenRoot);
  return summarizePathInspection(files, issues);
}

function parseFixtureInventory(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.contractVersion !== 1 ||
    !Array.isArray(value.fixtures)
  ) {
    throw new TypeError(
      "Generation golden fixture inventory must be version 1.",
    );
  }

  const fixtures = [];
  const portableIds = new Set();
  for (const fixture of value.fixtures) {
    if (
      typeof fixture !== "object" ||
      fixture === null ||
      typeof fixture.id !== "string" ||
      !fixtureIdPattern.test(fixture.id) ||
      !Array.isArray(fixture.layers) ||
      typeof fixture.support !== "string" ||
      !supportedStatuses.has(fixture.support)
    ) {
      throw new TypeError("Generation golden fixture inventory is malformed.");
    }
    const portableId = fixture.id.normalize("NFC").toLowerCase();
    if (portableIds.has(portableId)) {
      throw new TypeError(
        `Duplicate generation golden fixture ID: ${fixture.id}.`,
      );
    }
    portableIds.add(portableId);

    const layers = new Set();
    for (const layer of fixture.layers) {
      if (typeof layer !== "string" || !supportedLayers.has(layer)) {
        throw new TypeError(
          `Unsupported generation golden fixture layer for ${fixture.id}.`,
        );
      }
      if (layers.has(layer)) {
        throw new TypeError(
          `Duplicate generation golden fixture layer for ${fixture.id}.`,
        );
      }
      layers.add(layer);
    }
    fixtures.push({ id: fixture.id, layers, support: fixture.support });
  }
  return fixtures;
}

function expectedFixtureInventory(fixtures) {
  const fixtureIds = [];
  const categories = [];
  for (const fixture of fixtures) {
    if (fixture.support !== "supported") continue;
    fixtureIds.push(fixture.id);
    if (fixture.layers.has("application")) {
      categories.push(
        `${fixture.id}/application-source`,
        `${fixture.id}/contracts`,
        `${fixture.id}/manifests/application`,
      );
    }
    if (fixture.layers.has("iac")) {
      categories.push(`${fixture.id}/iac`, `${fixture.id}/manifests/terraform`);
    }
  }
  fixtureIds.sort(compareUtf16);
  categories.sort(compareUtf16);
  return { categories, fixtureIds };
}

async function actualFixtureInventory(goldenRoot) {
  const categories = [];
  const fixtureIds = [];
  const invalidEntries = [];
  const fixtures = sortedEntries(
    await readdir(goldenRoot, { withFileTypes: true }),
  );
  for (const fixture of fixtures) {
    fixtureIds.push(fixture.name);
    if (!fixture.isDirectory() || !fixtureIdPattern.test(fixture.name)) {
      invalidEntries.push(fixture.name);
      if (!fixture.isDirectory()) continue;
    }
    const fixtureRoot = path.join(goldenRoot, fixture.name);
    const entries = sortedEntries(
      await readdir(fixtureRoot, { withFileTypes: true }),
    );
    for (const entry of entries) {
      const category = `${fixture.name}/${entry.name}`;
      if (!entry.isDirectory()) {
        invalidEntries.push(category);
        continue;
      }
      if (entry.name !== "manifests") {
        categories.push(category);
        continue;
      }
      const manifestEntries = sortedEntries(
        await readdir(path.join(fixtureRoot, entry.name), {
          withFileTypes: true,
        }),
      );
      for (const manifestEntry of manifestEntries) {
        const manifestCategory = `${category}/${manifestEntry.name}`;
        if (!manifestEntry.isDirectory()) {
          invalidEntries.push(manifestCategory);
          continue;
        }
        categories.push(manifestCategory);
      }
    }
  }
  categories.sort(compareUtf16);
  fixtureIds.sort(compareUtf16);
  invalidEntries.sort(compareUtf16);
  return { categories, fixtureIds, invalidEntries };
}

function difference(left, right) {
  const rightValues = new Set(right);
  return left.filter((value) => !rightValues.has(value));
}

export async function inspectGenerationGoldenInventory(
  goldenRoot,
  inventoryPath,
) {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const expected = expectedFixtureInventory(parseFixtureInventory(inventory));
  const actual = await actualFixtureInventory(goldenRoot);
  return {
    actualCategories: actual.categories,
    actualFixtureIds: actual.fixtureIds,
    expectedCategories: expected.categories,
    expectedFixtureIds: expected.fixtureIds,
    invalidEntries: actual.invalidEntries,
    missingCategories: difference(expected.categories, actual.categories),
    missingFixtureIds: difference(expected.fixtureIds, actual.fixtureIds),
    unexpectedCategories: difference(actual.categories, expected.categories),
    unexpectedFixtureIds: difference(actual.fixtureIds, expected.fixtureIds),
  };
}

export async function assertGenerationGoldenInventory(
  goldenRoot,
  inventoryPath,
) {
  const inspection = await inspectGenerationGoldenInventory(
    goldenRoot,
    inventoryPath,
  );
  const differences = [
    ["missing fixtures", inspection.missingFixtureIds],
    ["unexpected fixtures", inspection.unexpectedFixtureIds],
    ["missing categories", inspection.missingCategories],
    ["unexpected categories", inspection.unexpectedCategories],
    ["invalid entries", inspection.invalidEntries],
  ].filter(([, values]) => values.length > 0);
  if (differences.length > 0) {
    throw new Error(
      `Generation golden inventory validation failed:\n${differences
        .map(([label, values]) => `${label}: ${values.join(", ")}`)
        .join("\n")}`,
    );
  }
  return inspection;
}

export async function assertGenerationGoldenPaths(repositoryRoot, goldenRoot) {
  const inspection = await inspectGenerationGoldenPaths(
    repositoryRoot,
    goldenRoot,
  );
  if (inspection.issues.length > 0) {
    const details = inspection.issues
      .map(
        ({ filePath, kind, limit, value }) =>
          `${kind}: ${String(value)}${limit > 0 ? ` > ${String(limit)}` : ""}: ${filePath}`,
      )
      .join("\n");
    throw new Error(`Generation golden path validation failed:\n${details}`);
  }
  return inspection;
}
