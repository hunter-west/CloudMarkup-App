import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GENERATION_GOLDEN_MAX_FILENAME,
  GENERATION_GOLDEN_MAX_REPOSITORY_PATH,
  assertGenerationGoldenInventory,
  assertGenerationGoldenPaths,
  inspectGenerationGoldenInventory,
  inspectGenerationGoldenPaths,
  inspectGenerationGoldenRelativePaths,
} from "./generation-golden-paths.mjs";

const script = fileURLToPath(
  new URL("./update-generation-goldens.mjs", import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const goldenRoot = fileURLToPath(
  new URL("../testdata/generation-goldens-v1/goldens/", import.meta.url),
);
const inventoryPath = fileURLToPath(
  new URL(
    "../testdata/generation-goldens-v1/fixture-inventory.json",
    import.meta.url,
  ),
);

async function withTemporaryDirectory(run) {
  const root = await mkdtemp(
    path.join(tmpdir(), "cloudmarkup-generation-golden-paths-"),
  );
  try {
    return await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeFixture(root, relativePath, content = "synthetic\n") {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

function invoke(arguments_) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    encoding: "utf8",
    shell: false,
  });
}

test("generation golden updates refuse missing confirmation and summary", () => {
  const result = invoke(["--category", "iac"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exact --confirm token is required/i);
  assert.doesNotMatch(result.stdout, /Updating generation goldens/);
});

test("generation golden updates refuse unknown categories", () => {
  const result = invoke([
    "--category",
    "future",
    "--confirm",
    "UPDATE_REVIEWED_GENERATION_GOLDENS",
    "--summary",
    "A reviewer-readable synthetic summary",
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /supported --category is required/i);
  assert.doesNotMatch(result.stdout, /Updating generation goldens/);
});

test("golden path budgets allow exact boundaries and reject overflow", () => {
  const filenameAtLimit = `${"g".repeat(91)}.json`;
  const pathAtLimit = `${"g".repeat(83)}/${filenameAtLimit}`;
  assert.equal(filenameAtLimit.length, GENERATION_GOLDEN_MAX_FILENAME);
  assert.equal(pathAtLimit.length, GENERATION_GOLDEN_MAX_REPOSITORY_PATH);
  assert.deepEqual(
    inspectGenerationGoldenRelativePaths([pathAtLimit]).issues,
    [],
  );

  const filenameOverflow = `${"g".repeat(92)}.json`;
  const pathOverflow = `${"g".repeat(84)}/${filenameAtLimit}`;
  const inspection = inspectGenerationGoldenRelativePaths([
    filenameOverflow,
    pathOverflow,
  ]);
  assert.deepEqual(
    inspection.issues.map(({ filePath, kind, limit, value }) => ({
      filePath,
      kind,
      limit,
      value,
    })),
    [
      {
        filePath: pathOverflow,
        kind: "repository-path-length",
        limit: GENERATION_GOLDEN_MAX_REPOSITORY_PATH,
        value: 181,
      },
      {
        filePath: filenameOverflow,
        kind: "filename-length",
        limit: GENERATION_GOLDEN_MAX_FILENAME,
        value: 97,
      },
    ],
  );
});

test("golden path inspection rejects traversal and Windows-invalid components", () => {
  const cases = [
    ["../escape/file.json", "unsafe-path"],
    ["C:/escape/file.json", "unsafe-path"],
    ["fixture\\contracts\\file.json", "unsafe-path"],
    ["fixture/contracts/aux.txt", "windows-invalid-component"],
    ["fixture/contracts/COM1.json", "windows-invalid-component"],
    ["fixture/contracts/file.json.", "windows-invalid-component"],
    ["fixture/contracts/file.json ", "windows-invalid-component"],
    ["fixture/contracts/file.json:stream", "windows-invalid-component"],
    ["fixture/contracts/bad\u0001name.json", "windows-invalid-component"],
    ["fixture/contracts/bad<name>.json", "windows-invalid-component"],
    ["fixture/contracts/bad>name.json", "windows-invalid-component"],
    ['fixture/contracts/bad"name.json', "windows-invalid-component"],
    ["fixture/contracts/bad|name.json", "windows-invalid-component"],
    ["fixture/contracts/bad?name.json", "windows-invalid-component"],
    ["fixture/contracts/bad*name.json", "windows-invalid-component"],
  ];
  const forward = inspectGenerationGoldenRelativePaths(
    cases.map(([relativePath]) => relativePath),
  );
  const reversed = inspectGenerationGoldenRelativePaths(
    cases.map(([relativePath]) => relativePath).reverse(),
  );

  assert.deepEqual(forward, reversed);
  for (const [relativePath, expectedKind] of cases) {
    assert.ok(
      forward.issues.some(
        ({ filePath, kind }) =>
          filePath === relativePath && kind === expectedKind,
      ),
      `${relativePath} must report ${expectedKind}`,
    );
  }
  const issuePaths = forward.issues.map(({ filePath }) => filePath);
  assert.deepEqual(issuePaths, [...issuePaths].sort());
});

test("golden path inspection rejects NFC and case-fold-equivalent paths", () => {
  const inspection = inspectGenerationGoldenRelativePaths([
    "fixture/contracts/name.json",
    "fixture/contracts/NAME.json",
    "fixture/contracts/É.json",
    "fixture/contracts/e\u0301.json",
  ]);
  const collisions = inspection.issues.filter(
    ({ kind }) => kind === "portable-path-collision",
  );

  assert.equal(collisions.length, 2);
  assert.deepEqual(
    collisions.map(({ filePath, relatedPath }) => ({ filePath, relatedPath })),
    [
      {
        filePath: "fixture/contracts/name.json",
        relatedPath: "fixture/contracts/NAME.json",
      },
      {
        filePath: "fixture/contracts/É.json",
        relatedPath: "fixture/contracts/e\u0301.json",
      },
    ],
  );
});

test("golden path inspection rejects roots outside the repository", async () => {
  await withTemporaryDirectory(async (root) => {
    const repository = path.join(root, "repository");
    const outside = path.join(root, "outside");
    await mkdir(repository);
    await mkdir(outside);
    const inspection = await inspectGenerationGoldenPaths(repository, outside);
    assert.deepEqual(
      inspection.issues.map(({ kind }) => kind),
      ["unsafe-golden-root"],
    );
  });

  const differentDrive = await inspectGenerationGoldenPaths(
    "C:\\repository",
    "D:\\goldens",
  );
  assert.deepEqual(
    differentDrive.issues.map(({ kind }) => kind),
    ["unsafe-golden-root"],
  );
});

test("golden path assertion invokes the filesystem scanner", async () => {
  await withTemporaryDirectory(async (root) => {
    const golden = path.join(root, "goldens");
    await mkdir(golden);
    await writeFixture(golden, "valid.json");
    const valid = await assertGenerationGoldenPaths(root, golden);
    assert.deepEqual(valid.files, ["goldens/valid.json"]);

    const digest = "abcdef0123456789".repeat(4);
    await writeFixture(golden, `contract-${digest}.json`);
    await assert.rejects(
      assertGenerationGoldenPaths(root, golden),
      /full-digest-filename/u,
    );
  });
});

test("checked-in golden paths satisfy repository budgets", async () => {
  const inspection = await assertGenerationGoldenPaths(
    repositoryRoot,
    goldenRoot,
  );
  assert.equal(inspection.issues.length, 0);
  assert.ok(
    inspection.maximumPathLength <= GENERATION_GOLDEN_MAX_REPOSITORY_PATH,
  );
  assert.ok(inspection.maximumFilenameLength <= GENERATION_GOLDEN_MAX_FILENAME);
});

test("golden path scanner rejects symlink roots and reports links relatively", async () => {
  await withTemporaryDirectory(async (root) => {
    const repository = path.join(root, "repository");
    const golden = path.join(repository, "goldens");
    const outside = path.join(root, "outside");
    await mkdir(golden, { recursive: true });
    await mkdir(path.join(outside, "nested-goldens"), { recursive: true });

    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, path.join(golden, "linked-directory"), linkType);
    const nestedInspection = await inspectGenerationGoldenPaths(
      repository,
      golden,
    );
    assert.deepEqual(
      nestedInspection.issues.map(({ filePath, kind }) => ({ filePath, kind })),
      [
        {
          filePath: "goldens/linked-directory",
          kind: "non-regular-file",
        },
      ],
    );

    const linkedRoot = path.join(repository, "linked-root");
    await symlink(outside, linkedRoot, linkType);
    const rootInspection = await inspectGenerationGoldenPaths(
      repository,
      linkedRoot,
    );
    assert.deepEqual(
      rootInspection.issues.map(({ kind }) => kind),
      ["unsafe-golden-root"],
    );

    const ancestorLink = path.join(repository, "ancestor-link");
    await symlink(outside, ancestorLink, linkType);
    const escapedInspection = await inspectGenerationGoldenPaths(
      repository,
      path.join(ancestorLink, "nested-goldens"),
    );
    assert.deepEqual(
      escapedInspection.issues.map(({ kind }) => kind),
      ["unsafe-golden-root"],
    );
  });
});

test("checked-in golden fixtures and categories exactly match inventory", async () => {
  const inspection = await assertGenerationGoldenInventory(
    goldenRoot,
    inventoryPath,
  );
  assert.deepEqual(inspection.actualFixtureIds, inspection.expectedFixtureIds);
  assert.deepEqual(inspection.actualCategories, inspection.expectedCategories);
  assert.deepEqual(inspection.invalidEntries, []);
});

test("golden inventory reports missing and obsolete roots exactly", async () => {
  await withTemporaryDirectory(async (root) => {
    const golden = path.join(root, "goldens");
    const inventory = path.join(root, "fixture-inventory.json");
    await writeFile(
      inventory,
      `${JSON.stringify({
        contractVersion: 1,
        fixtures: [
          { id: "fixture-a", layers: ["application"], support: "supported" },
          { id: "fixture-iac", layers: ["iac"], support: "supported" },
          { id: "negative", layers: ["application"], support: "negative" },
        ],
      })}\n`,
      "utf8",
    );
    for (const directory of [
      "fixture-a/application-source",
      "fixture-a/contracts",
      "fixture-a/extra",
      "fixture-a/manifests/application",
      "fixture-iac/iac",
      "orphan/contracts",
    ]) {
      await mkdir(path.join(golden, ...directory.split("/")), {
        recursive: true,
      });
    }

    const inspection = await inspectGenerationGoldenInventory(
      golden,
      inventory,
    );
    assert.deepEqual(inspection.missingFixtureIds, []);
    assert.deepEqual(inspection.unexpectedFixtureIds, ["orphan"]);
    assert.deepEqual(inspection.missingCategories, [
      "fixture-iac/manifests/terraform",
    ]);
    assert.deepEqual(inspection.unexpectedCategories, [
      "fixture-a/extra",
      "orphan/contracts",
    ]);
    await assert.rejects(
      assertGenerationGoldenInventory(golden, inventory),
      /unexpected fixtures.*missing categories.*unexpected categories/su,
    );
  });
});

test("golden inventory rejects malicious fixture identifiers", async () => {
  await withTemporaryDirectory(async (root) => {
    const golden = path.join(root, "goldens");
    const inventory = path.join(root, "fixture-inventory.json");
    await mkdir(golden);
    await writeFile(
      inventory,
      `${JSON.stringify({
        contractVersion: 1,
        fixtures: [
          {
            id: "../escape",
            layers: ["application"],
            support: "supported",
          },
        ],
      })}\n`,
      "utf8",
    );

    await assert.rejects(
      inspectGenerationGoldenInventory(golden, inventory),
      /fixture inventory is malformed/u,
    );
  });
});
