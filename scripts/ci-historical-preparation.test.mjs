import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { createVitest } from "vitest/node";
import { runtimeFiles } from "./run-beta-tests.mjs";
import {
  HISTORICAL_RECEIPT_TEST,
  inspectCiShard,
  parseCiShard,
  planCiHistoricalPreparation,
} from "./ci-historical-preparation.mjs";

const root = resolve(".");
const specification = (file, project = "api") => ({
  moduleId: resolve(root, file),
  project: { name: project },
});
const all = [
  specification(HISTORICAL_RECEIPT_TEST),
  ...Array.from({ length: 8 }, (_, i) =>
    specification(`apps/api/src/synthetic-${i}.test.ts`),
  ),
];

test("invalid shard input fails before creating a runner", async () => {
  for (const shard of [
    undefined,
    "",
    "0/8",
    "9/8",
    "1/7",
    "01/8",
    "1/8 --exclude x",
    "1/8\n",
  ]) {
    assert.throws(() => parseCiShard(shard));
    await assert.rejects(
      planCiHistoricalPreparation(shard, () => {
        assert.fail("runner must not start");
      }),
    );
  }
});

test("preparation is required only for the selected historical regression", () => {
  assert.equal(inspectCiShard(all, [all[0]], root).historicalRequired, true);
  assert.equal(inspectCiShard(all, [all[1]], root).historicalRequired, false);
});

test("small impacted projects permit empty individual shards and need no historical fixture", () => {
  const web = [specification("apps/web/src/example.test.tsx", "web")];
  assert.equal(inspectCiShard(web, [], root, true).historicalRequired, false);
  assert.equal(inspectCiShard(web, web, root, true).selectedFiles, 1);
  assert.throws(() => inspectCiShard([], [], root, true));
  assert.throws(() => inspectCiShard(web, [all[0]], root, true));
});

test("missing, empty, duplicated, foreign and malformed discovery fails closed", () => {
  for (const [inventory, selected] of [
    [all.slice(1), [all[1]]],
    [all, []],
    [[...all, specification(HISTORICAL_RECEIPT_TEST, "web")], [all[0]]],
    [[...all, all[0]], [all[0]]],
    [all, [all[0], all[0]]],
    [all, [specification("apps/api/src/unknown.test.ts")]],
    [[...all, specification("../outside.test.ts")], [all[0]]],
    [
      [...all, { moduleId: "relative.test.ts", project: { name: "api" } }],
      [all[0]],
    ],
  ])
    assert.throws(() => inspectCiShard(inventory, selected, root));
});

test("a failed sequencer closes discovery and never returns a skip decision", async () => {
  let closed = false;
  await assert.rejects(
    planCiHistoricalPreparation("1/8", async () => ({
      config: {
        root,
        shard: { index: 1, count: 8 },
        sequence: {
          sequencer: class {
            shard() {
              throw new Error("discovery failed");
            }
          },
        },
      },
      getRelevantTestSpecifications: async () => all,
      close: async () => {
        closed = true;
      },
    })),
    /discovery failed/u,
  );
  assert.equal(closed, true);
});

test(
  "real configured shards retain every test once and exactly one historical preparation",
  { timeout: 120000 },
  async () => {
    // Discover through the real planner once per profile. Sharding consumes only
    // immutable module/project identities, not another Vite startup per index.
    async function partitions(options = {}) {
      let inventory;
      let resolved;
      const first = await planCiHistoricalPreparation(
        "1/8",
        async (mode, configuration) => {
          const context = await createVitest(mode, configuration);
          const discover = context.getRelevantTestSpecifications.bind(context);
          context.getRelevantTestSpecifications = async (filters) => {
            assert.equal(inventory, undefined);
            const specifications = await discover(filters);
            inventory = Object.freeze(
              specifications.map(({ moduleId, project }) =>
                Object.freeze({
                  moduleId,
                  project: Object.freeze({ name: project.name }),
                }),
              ),
            );
            resolved = Object.freeze({
              root: context.config.root,
              sequencer: context.config.sequence.sequencer,
            });
            return specifications;
          };
          return context;
        },
        options,
      );
      assert.ok(inventory);
      assert.ok(resolved);
      const results = [];
      for (let index = 1; index <= 8; index++) {
        const sequencer = new resolved.sequencer({
          config: {
            root: resolved.root,
            shard: { index, count: 8 },
          },
        });
        const selected = await sequencer.shard([...inventory]);
        results.push(
          inspectCiShard(
            inventory,
            selected,
            resolved.root,
            Boolean(options.projects?.length),
          ),
        );
      }
      const { shard: _shard, ...firstPartition } = first;
      assert.equal(_shard, "1/8");
      assert.deepEqual(results[0], firstPartition);
      return results;
    }
    const selected = new Set();
    let total;
    let historicalShards = 0;
    for (const result of await partitions()) {
      total ??= result.totalFiles;
      assert.equal(result.totalFiles, total);
      if (result.historicalRequired) historicalShards++;
      for (const key of result.specifications) {
        assert.equal(selected.has(key), false, `duplicate ${key}`);
        selected.add(key);
      }
    }
    // These evaluation cases used to run twice in CI. Their owning projects
    // must remain in the complete shard inventory before duplicate work is removed.
    for (const key of [
      "ai-extension-generation:packages/ai-extension-generation/src/model-evaluation.e2e.test.ts",
      "web:apps/web/src/features/assistant/assistant-workspace.e2e.test.tsx",
    ])
      assert.ok(selected.has(key), "Missing evaluation coverage: " + key);
    assert.equal(selected.size, total);
    assert.equal(historicalShards, 1);
    const diagnostic = new Set();
    let diagnosticTotal;
    let diagnosticHistoricalShards = 0;
    for (const result of await partitions({ coverage: true })) {
      diagnosticTotal ??= result.totalFiles;
      assert.equal(result.totalFiles, diagnosticTotal);
      if (result.historicalRequired) diagnosticHistoricalShards++;
      for (const key of result.specifications) {
        assert.equal(diagnostic.has(key), false, `duplicate ${key}`);
        diagnostic.add(key);
      }
    }
    assert.equal(diagnostic.size, diagnosticTotal);
    assert.equal(diagnosticHistoricalShards, 1);
    assert.deepEqual(
      [...diagnostic].filter((key) => !selected.has(key)).sort(),
      runtimeFiles.map((file) => `api:${file}`).sort(),
    );
    for (const key of selected) assert.ok(diagnostic.has(key));
    const webFiles = new Set();
    let webTotal;
    for (const result of await partitions({ projects: ["web"] })) {
      webTotal ??= result.totalFiles;
      assert.equal(result.totalFiles, webTotal);
      assert.equal(result.historicalRequired, false);
      for (const key of result.specifications) {
        assert.ok(key.startsWith("web:"));
        assert.equal(webFiles.has(key), false, `duplicate ${key}`);
        webFiles.add(key);
      }
    }
    assert.equal(webFiles.size, webTotal);
  },
);
