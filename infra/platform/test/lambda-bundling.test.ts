import { execFileSync } from "node:child_process";
import { buildBetaApiRuntime } from "../lib/beta-api-runtime-asset.js";
import { buildSolutionExportWorkerRuntime } from "../lib/solution-export-runtime-asset.js";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const repositoryManifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
) as { readonly devDependencies?: Readonly<Record<string, string>> };
const outputDirectory = fileURLToPath(
  new URL("../.lambda-bundle-test", import.meta.url),
);
const migrationEntry = fileURLToPath(
  new URL("../runtime/database-migrator.ts", import.meta.url),
);
const migrationManifest = readFileSync(
  fileURLToPath(
    new URL("../../../apps/api/migrations/manifest.json", import.meta.url),
  ),
  "utf8",
);
const localRequire = createRequire(import.meta.url);

function portablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

interface BundledMigrator {
  readonly loadMigrations: () => readonly unknown[];
  readonly runMigrations: (
    client: {
      readonly send: (
        command: unknown,
      ) => Promise<Readonly<Record<string, unknown>>>;
    },
    migrations: readonly {
      readonly checksumSha256: string;
      readonly file: string;
      readonly statements: readonly string[];
      readonly version: string;
    }[],
  ) => Promise<
    readonly { readonly checksum_sha256: string; readonly version: string }[]
  >;
}

async function bundleMigrator(
  manifestSource?: string,
): Promise<BundledMigrator> {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "cloudmarkup-migration-bundle-"),
  );
  const outputFile = join(temporaryDirectory, "database-migrator.cjs");
  try {
    await build({
      absWorkingDir: repositoryRoot,
      bundle: true,
      entryPoints: [migrationEntry],
      format: "cjs",
      loader: { ".sql": "text" },
      logLevel: "silent",
      minify: false,
      outfile: outputFile,
      platform: "node",
      plugins:
        manifestSource === undefined
          ? []
          : [
              {
                name: "migration-manifest-source",
                setup(context) {
                  context.onLoad(
                    {
                      filter:
                        /[\\/]apps[\\/]api[\\/]migrations[\\/]manifest\.json$/,
                    },
                    () => ({ contents: manifestSource, loader: "json" }),
                  );
                },
              },
            ],
      target: "node24",
    });
    const loaded: unknown = localRequire(outputFile);
    if (
      typeof loaded !== "object" ||
      loaded === null ||
      !("loadMigrations" in loaded) ||
      typeof loaded.loadMigrations !== "function" ||
      !("runMigrations" in loaded) ||
      typeof loaded.runMigrations !== "function"
    ) {
      throw new TypeError("The migration bundle exports are invalid.");
    }
    return loaded as BundledMigrator;
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function commandDetails(command: unknown): {
  readonly input: Readonly<Record<string, unknown>>;
  readonly name: string;
} {
  if (typeof command !== "object" || command === null) {
    throw new TypeError("The RDS Data command is invalid.");
  }
  const candidate = command as { readonly input?: unknown };
  const prototype = Object.getPrototypeOf(command) as {
    readonly constructor?: unknown;
  } | null;
  if (
    typeof prototype?.constructor !== "function" ||
    typeof candidate.input !== "object" ||
    candidate.input === null ||
    Array.isArray(candidate.input)
  ) {
    throw new TypeError("The RDS Data command is invalid.");
  }
  return {
    input: candidate.input as Readonly<Record<string, unknown>>,
    name: prototype.constructor.name.replace(/\d+$/u, ""),
  };
}

async function withDatabaseEnvironment<T>(
  action: () => Promise<T>,
): Promise<T> {
  const environment = {
    CLOUDMARKUP_DATABASE_ARN:
      "arn:aws:rds:us-east-1:111122223333:cluster:test-cluster",
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_DATABASE_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:111122223333:secret:test-secret",
  } as const;
  const previous = new Map(
    Object.keys(environment).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, environment);
  try {
    return await action();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  }
}

const orderTestMigrations = ["0093", "0094", "0095"].map((version, index) => ({
  version,
  file: `${version}_order_test.sql`,
  checksumSha256: String(index + 1).repeat(64),
  statements: [`CREATE TABLE order_test_${version} (id INTEGER PRIMARY KEY)`],
}));
interface MigrationEvidence {
  readonly version: string;
  readonly checksum_sha256: string;
}
function orderTestRow(index: number): MigrationEvidence {
  const migration = orderTestMigrations[index];
  if (!migration) throw new Error("Missing test migration");
  return {
    version: migration.version,
    checksum_sha256: migration.checksumSha256,
  };
}
function orderTransport(
  initial: readonly MigrationEvidence[],
  options: {
    readonly concurrentSuccessor?: MigrationEvidence;
    readonly failFirstUpgrade?: boolean;
  } = {},
) {
  const ledger = new Map(initial.map((row) => [row.version, row]));
  const executed: string[] = [];
  const trace: string[] = [];
  let staged: Map<string, MigrationEvidence> | undefined;
  let successor = options.concurrentSuccessor;
  let failUpgrade = options.failFirstUpgrade === true;
  let rollbacks = 0;
  const client = {
    async send(command: unknown): Promise<Readonly<Record<string, unknown>>> {
      await Promise.resolve();
      const { input, name } = commandDetails(command);
      if (name === "BeginTransactionCommand") {
        staged = new Map(ledger);
        return { transactionId: "order-test-transaction" };
      }
      if (name === "CommitTransactionCommand") {
        if (!staged) throw new Error("No test transaction to commit");
        ledger.clear();
        for (const [version, row] of staged) ledger.set(version, row);
        staged = undefined;
        return {};
      }
      if (name === "RollbackTransactionCommand") {
        staged = undefined;
        rollbacks += 1;
        return {};
      }
      if (
        name !== "ExecuteStatementCommand" ||
        typeof input["sql"] !== "string"
      )
        throw new Error("Unexpected migration transport command");
      const sql = input["sql"];
      trace.push(sql);
      const state =
        typeof input["transactionId"] === "string" ? staged : ledger;
      if (!state) throw new Error("Missing test transaction state");
      const parameter = (key: string) => {
        const values = input["parameters"] as
          | readonly { name: string; value: { stringValue: string } }[]
          | undefined;
        const value = values?.find((entry) => entry.name === key)?.value
          .stringValue;
        if (value === undefined) throw new Error("Missing test SQL parameter");
        return value;
      };
      if (sql === "SELECT pg_advisory_xact_lock(21000000)") {
        if (successor) {
          state.set(successor.version, successor);
          ledger.set(successor.version, successor);
          successor = undefined;
        }
        return { formattedRecords: '[{"pg_advisory_xact_lock":""}]' };
      }
      if (sql.startsWith("SELECT version, checksum_sha256")) {
        const rows = [...state.values()]
          .filter((row) =>
            sql.includes("WHERE version >")
              ? row.version > parameter("version")
              : sql.includes("WHERE version =")
                ? row.version === parameter("version")
                : true,
          )
          .sort((left, right) => left.version.localeCompare(right.version));
        return { formattedRecords: JSON.stringify(rows) };
      }
      if (sql.startsWith("INSERT INTO cloudmarkup_schema_migrations")) {
        const version = parameter("version");
        state.set(version, { version, checksum_sha256: parameter("checksum") });
      } else if (sql.startsWith("CREATE TABLE order_test_")) {
        executed.push(sql);
        if (failUpgrade && sql === orderTestMigrations[1]?.statements[0]) {
          failUpgrade = false;
          throw new Error("Simulated migration statement failure");
        }
      } else if (!sql.startsWith("CREATE TABLE IF NOT EXISTS")) {
        throw new Error("Unexpected migration SQL");
      }
      return {};
    },
  };
  return { client, ledger, executed, trace, rollbacks: () => rollbacks };
}

describe("Lambda bundling boundaries", () => {
  it("bundles the real project erasure host through its declared export", async () => {
    const result = await build({
      absWorkingDir: repositoryRoot,
      bundle: true,
      entryPoints: [
        fileURLToPath(
          new URL("../runtime/project-content-cleanup.ts", import.meta.url),
        ),
      ],
      format: "cjs",
      logLevel: "silent",
      metafile: true,
      outdir: outputDirectory,
      platform: "node",
      target: "node24",
      minifyWhitespace: true,
      sourcemap: "external",
      sourcesContent: false,
      external: ["@aws-sdk/*"],
      write: false,
    });
    expect(result.warnings).toEqual([]);
    const javascript = result.outputFiles.find((file) =>
      file.path.endsWith(".js"),
    );
    if (javascript === undefined)
      throw new Error("The cleanup bundle is missing.");
    const checksums = [
      ...javascript.text.matchAll(
        /\b(?:var|let|const) schemaChecksum\s*=\s*"([0-9a-f]{64})"/gu,
      ),
    ].map((match) => match[1]);
    const manifest = JSON.parse(migrationManifest) as {
      migrations: readonly { checksumSha256: string }[];
    };
    expect(checksums).toEqual([manifest.migrations.at(-1)?.checksumSha256]);
    expect(javascript.text).toContain(
      "j.idempotency_scope IS DISTINCT FROM 'cloudmarkup.beta-infrastructure-proposals.create'",
    );
    for (const file of result.outputFiles) {
      expect(file.contents.length).toBeLessThanOrEqual(10 * 1024 * 1024);
      if (file.path.endsWith(".map"))
        expect(
          (JSON.parse(file.text) as { sourcesContent?: unknown })
            .sourcesContent,
        ).toBeUndefined();
    }
    const inputs = Object.keys(result.metafile.inputs).map(portablePath);
    expect(inputs).toContain(
      "apps/api/dist/production-project-content-cleanup.js",
    );
    expect(inputs).toContain(
      "apps/api/dist/adapters/persistence/s3-project-content-eraser.js",
    );
    expect(inputs).toContain(
      "apps/api/dist/adapters/persistence/project-content-write-fence.js",
    );
    expect(inputs.join("\n")).not.toMatch(
      /local-development|memory-object-store|stripe-billing-provider/u,
    );
  }, 30_000);
  it("bundles the real sandbox consumer without local or placeholder provider fallbacks", async () => {
    const result = await build({
      absWorkingDir: repositoryRoot,
      bundle: true,
      entryNames: "billing-worker",
      entryPoints: [
        fileURLToPath(new URL("../runtime/billing-worker.ts", import.meta.url)),
      ],
      format: "cjs",
      logLevel: "silent",
      metafile: true,
      outdir: outputDirectory,
      platform: "node",
      target: "node24",
      write: false,
    });
    const javascript = result.outputFiles.find((file) =>
      portablePath(file.path).endsWith("/billing-worker.js"),
    );
    const inputs = Object.values(result.metafile.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, metadata]) => metadata.bytesInOutput > 0)
        .map(([path]) => portablePath(path)),
    );
    expect(result.warnings).toEqual([]);
    expect(javascript).toBeDefined();
    expect(inputs).toContain("apps/api/dist/billing-worker.js");
    expect(inputs).toContain(
      "apps/api/dist/adapters/billing/durable-queue-worker.js",
    );
    expect(inputs).toContain(
      "apps/api/dist/adapters/persistence/rds-data-driver.js",
    );
    expect(javascript?.text).toContain("batch-retry");
    expect(javascript?.text).not.toMatch(
      /FakeBillingProvider|CLOUDMARKUP_DEPLOYMENT_SHELL|bedrock:InvokeModel/u,
    );
  }, 30_000);

  it("makes esbuild resolvable from CDK's workspace-root bundling directory", () => {
    expect(repositoryManifest.devDependencies?.["esbuild"]).toBe("catalog:");
  });

  it("loads the real beta API cold without its optional native layer and keeps native imports in a lazy chunk", () => {
    const directory = mkdtempSync(join(tmpdir(), "cloudmarkup-api-esm-test-"));
    const path = resolve(directory);
    if (
      !path.startsWith(resolve(tmpdir()) + sep) ||
      !path.includes("cloudmarkup-api-esm-test-")
    )
      throw new Error("Unexpected API test cleanup path.");
    try {
      const result = buildBetaApiRuntime(directory);
      expect(result.warnings).toEqual([]);
      const outputs = result.metafile.outputs;
      const entry = Object.keys(outputs).find((path) =>
        portablePath(path).endsWith("/index.mjs"),
      );
      if (entry === undefined)
        throw new Error("Actual API bundle has no ESM entry.");
      const visited = new Set<string>();
      const visit = (path: string) => {
        if (visited.has(path)) return;
        visited.add(path);
        for (const dependency of outputs[path]?.imports ?? []) {
          if (!dependency.external && dependency.kind !== "dynamic-import")
            visit(dependency.path);
        }
      };
      visit(entry);
      const initialInputs = [...visited].flatMap((path) =>
        Object.keys(outputs[path]?.inputs ?? {}),
      );
      expect(
        initialInputs.some((path) =>
          /diagram-export\/dist\/(?:renderer|service)\.js$/u.test(
            portablePath(path),
          ),
        ),
      ).toBe(false);
      expect(
        [...visited]
          .flatMap((path) => outputs[path]?.imports ?? [])
          .some((item) => item.path === "@resvg/resvg-js"),
      ).toBe(false);
      expect(
        Object.values(outputs).some((output) =>
          output.imports.some((item) => item.path === "@resvg/resvg-js"),
        ),
      ).toBe(true);
      expect(
        Object.values(outputs).some((output) =>
          output.imports.some((item) => item.kind === "dynamic-import"),
        ),
      ).toBe(true);
      for (const file of readdirSync(directory)) {
        const bytes = readFileSync(join(directory, file));
        expect(bytes.length).toBeLessThanOrEqual(10 * 1024 * 1024);
        if (file.endsWith(".map"))
          expect(
            (JSON.parse(bytes.toString("utf8")) as { sourcesContent?: unknown })
              .sourcesContent,
          ).toBeUndefined();
      }
      // The temporary directory has no node_modules or Lambda layer. A real
      // fresh Node process proves cold module initialization does not load Resvg.
      expect(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            'const api = await import(process.argv[1]); if (typeof api.handler !== "function") process.exit(1);',
            pathToFileURL(join(directory, "index.mjs")).href,
          ],
          {
            cwd: directory,
            env: {},
            shell: false,
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 65536,
          },
        ).byteLength,
      ).toBe(0);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  }, 30000);

  it("renders a real photo through the lazy API chunk with its supported native layer", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "cloudmarkup-photo-layer-test-"),
    );
    const root = resolve(directory);
    if (
      !root.startsWith(resolve(tmpdir()) + sep) ||
      !root.includes("cloudmarkup-photo-layer-test-")
    )
      throw new Error("Unexpected photo layer test cleanup path.");
    try {
      const result = buildBetaApiRuntime(root);
      expect(result.warnings).toEqual([]);
      const raster = Object.entries(result.metafile.outputs).find(
        ([, output]) =>
          Object.keys(output.inputs).some((input) =>
            portablePath(input).endsWith("/account-photo-raster.ts"),
          ),
      );
      if (raster === undefined)
        throw new Error("Actual API bundle has no lazy photo chunk.");
      expect(raster[1].exports).toContain("canonicalAccountPhoto");
      // Use the genuine installed host binding in an isolated layer layout.
      // Protected beta synthesis independently binds the Lambda ARM64 assets.
      const rendererRequire = createRequire(
        join(repositoryRoot, "packages/diagram-export/package.json"),
      );
      const rendererEntry = rendererRequire.resolve("@resvg/resvg-js");
      rendererRequire("@resvg/resvg-js");
      const nativeBinding = Object.keys(rendererRequire.cache).find((path) =>
        /^resvgjs\.[a-z0-9-]+\.node$/u.test(basename(path)),
      );
      if (nativeBinding === undefined)
        throw new Error("The actual host renderer binding is unavailable.");
      const layer = join(root, "node_modules/@resvg/resvg-js");
      mkdirSync(layer, { recursive: true });
      for (const file of ["index.js", "js-binding.js", "package.json"])
        copyFileSync(join(dirname(rendererEntry), file), join(layer, file));
      copyFileSync(nativeBinding, join(layer, basename(nativeBinding)));
      expect(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import { createRequire } from "node:module";
const { Resvg } = createRequire(import.meta.url)("@resvg/resvg-js");
const raster = await import(process.argv[1]);
const image = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#365ec8"/></svg>', { font: { loadSystemFonts: false }, logLevel: "off" }).render().asPng();
const photo = raster.canonicalAccountPhoto("data:image/png;base64," + image.toString("base64"));
if (!Buffer.isBuffer(photo) || photo.readUInt32BE(16) !== 192 || photo.readUInt32BE(20) !== 192 || !photo.equals(raster.canonicalAccountPhoto("data:image/png;base64," + photo.toString("base64")))) throw new Error("Lazy native photo rasterization failed.");`,
            pathToFileURL(join(root, basename(raster[0]))).href,
          ],
          {
            cwd: root,
            env: {},
            shell: false,
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 65536,
          },
        ).byteLength,
      ).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it("loads the actual export worker from bounded ESM chunks with source maps and names retained", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "cloudmarkup-worker-esm-test-"),
    );
    const root = resolve(directory);
    if (
      !root.startsWith(resolve(tmpdir()) + sep) ||
      !root.includes("cloudmarkup-worker-esm-test-")
    )
      throw new Error("Unexpected worker test cleanup path.");
    try {
      const result = buildSolutionExportWorkerRuntime(root);
      expect(result.warnings).toEqual([]);
      // This worker requires its renderer layer. Load the genuine installed
      // host binding and copy its reviewed entry, loader, package, fonts and binary into
      // the isolated process; beta synthesis separately proves Linux ARM64.
      const rendererRequire = createRequire(
        join(repositoryRoot, "packages/diagram-export/package.json"),
      );
      const rendererEntry = rendererRequire.resolve("@resvg/resvg-js");
      rendererRequire("@resvg/resvg-js");
      const nativeBinding = Object.keys(rendererRequire.cache).find((path) =>
        /^resvgjs\.[a-z0-9-]+\.node$/u.test(basename(path)),
      );
      if (nativeBinding === undefined)
        throw new Error("The actual host renderer binding is unavailable.");
      const rendererLayer = join(root, "node_modules/@resvg/resvg-js");
      mkdirSync(rendererLayer, { recursive: true });
      copyFileSync(rendererEntry, join(rendererLayer, "index.js"));
      copyFileSync(
        join(dirname(rendererEntry), "js-binding.js"),
        join(rendererLayer, "js-binding.js"),
      );
      copyFileSync(
        join(dirname(rendererEntry), "package.json"),
        join(rendererLayer, "package.json"),
      );
      copyFileSync(nativeBinding, join(rendererLayer, basename(nativeBinding)));
      const fontRoot = dirname(
        rendererRequire.resolve("@fontsource/inter/package.json"),
      );
      for (const file of [
        "package.json",
        "files/inter-latin-400-normal.woff2",
        "files/inter-latin-600-normal.woff2",
      ]) {
        const target = join(root, "node_modules/@fontsource/inter", file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(fontRoot, file), target);
      }
      expect(
        Object.values(result.metafile.outputs).some((output) =>
          output.imports.some((item) => item.kind === "dynamic-import"),
        ),
      ).toBe(true);
      const entry = join(root, "index.mjs");
      expect(readFileSync(entry, "utf8")).toContain("cloudmarkupCreateRequire");
      for (const file of readdirSync(root).filter(
        (file) => file.endsWith(".mjs") || file.endsWith(".map"),
      )) {
        const bytes = readFileSync(join(root, file));
        expect(bytes.length).toBeLessThanOrEqual(10 * 1024 * 1024);
        if (file.endsWith(".map"))
          expect(
            (JSON.parse(bytes.toString("utf8")) as { sourcesContent?: unknown })
              .sourcesContent,
          ).toBeUndefined();
        if (file.endsWith(".mjs"))
          expect(
            execFileSync(process.execPath, ["--check", join(root, file)], {
              cwd: root,
              env: {},
              shell: false,
              windowsHide: true,
              timeout: 15000,
              maxBuffer: 65536,
            }).byteLength,
          ).toBe(0);
      }
      expect(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            'const worker = await import(process.argv[1]); if (typeof worker.handler !== "function") process.exit(1);',
            pathToFileURL(entry).href,
          ],
          {
            cwd: root,
            env: {},
            shell: false,
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 65536,
          },
        ).byteLength,
      ).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it("bundles the exact migration manifest and fails closed on checksum drift", async () => {
    const previousDigest = process.env["CLOUDMARKUP_MIGRATION_MANIFEST_SHA256"];
    const previousVersion =
      process.env["CLOUDMARKUP_MIGRATION_EXPECTED_VERSION"];
    process.env["CLOUDMARKUP_MIGRATION_MANIFEST_SHA256"] = createHash("sha256")
      .update(migrationManifest)
      .digest("hex");
    process.env["CLOUDMARKUP_MIGRATION_EXPECTED_VERSION"] = "0138";
    try {
      const migrations = (await bundleMigrator()).loadMigrations() as readonly {
        readonly statements: readonly string[];
      }[];
      expect(migrations).toHaveLength(120);
      const statements = migrations.flatMap(({ statements: migrationSql }) => [
        ...migrationSql,
      ]);
      expect(statements).toHaveLength(1367);
      expect(
        Math.max(
          ...statements.map((statement) => Buffer.byteLength(statement)),
        ),
      ).toBeLessThanOrEqual(64 * 1024);
      const drifted = await bundleMigrator(
        migrationManifest.replace(
          '"storageContractVersion": 1',
          '"storageContractVersion": 2',
        ),
      );
      expect(() => drifted.loadMigrations()).toThrow(
        /manifest checksum is invalid/u,
      );
    } finally {
      if (previousDigest === undefined) {
        delete process.env["CLOUDMARKUP_MIGRATION_MANIFEST_SHA256"];
      } else {
        process.env["CLOUDMARKUP_MIGRATION_MANIFEST_SHA256"] = previousDigest;
      }
      if (previousVersion === undefined) {
        delete process.env["CLOUDMARKUP_MIGRATION_EXPECTED_VERSION"];
      } else {
        process.env["CLOUDMARKUP_MIGRATION_EXPECTED_VERSION"] = previousVersion;
      }
    }
  }, 30_000);

  it("accepts the RDS advisory-lock row without treating it as migration evidence", async () => {
    const migrator = await bundleMigrator();
    const checksumSha256 = "a".repeat(64);
    const commandNames: string[] = [];
    let inserted = false;
    const client = {
      async send(command: unknown): Promise<Readonly<Record<string, unknown>>> {
        await Promise.resolve();
        const { input, name } = commandDetails(command);
        commandNames.push(name);
        if (name === "BeginTransactionCommand") {
          return { transactionId: "transaction-1" };
        }
        if (name === "CommitTransactionCommand") return {};
        if (name === "RollbackTransactionCommand") {
          throw new TypeError("The successful migration must not roll back.");
        }
        if (name !== "ExecuteStatementCommand") {
          throw new TypeError(`Unexpected RDS Data command ${name}.`);
        }
        const sql = input["sql"];
        if (typeof sql !== "string") {
          throw new TypeError("The RDS Data SQL is invalid.");
        }
        if (sql === "SELECT pg_advisory_xact_lock(21000000)") {
          return {
            formattedRecords: '[{"pg_advisory_xact_lock":""}]',
          };
        }
        if (
          sql.includes(" WHERE version = :version") ||
          sql.includes(" WHERE version > :version")
        ) {
          return { formattedRecords: "[]" };
        }
        if (sql.includes(" ORDER BY version")) {
          if (!inserted) {
            throw new TypeError(
              "The migration ledger was queried before insert.",
            );
          }
          return {
            formattedRecords: JSON.stringify([
              { checksum_sha256: checksumSha256, version: "0001" },
            ]),
          };
        }
        if (
          sql ===
          "SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations"
        ) {
          return { formattedRecords: "[]" };
        }
        if (sql.startsWith("INSERT INTO cloudmarkup_schema_migrations")) {
          inserted = true;
        }
        return {};
      },
    };

    const applied = await withDatabaseEnvironment(() =>
      migrator.runMigrations(client, [
        {
          checksumSha256,
          file: "0001_test.sql",
          statements: ["CREATE TABLE migration_test (id INTEGER PRIMARY KEY)"],
          version: "0001",
        },
      ]),
    );

    expect(applied).toEqual([
      { checksum_sha256: checksumSha256, version: "0001" },
    ]);
    expect(commandNames).toContain("CommitTransactionCommand");
    expect(commandNames).not.toContain("RollbackTransactionCommand");
  }, 30_000);

  it("upgrades the bundled migration order and replays without rerunning SQL", async () => {
    const migrator = await bundleMigrator();
    const harness = orderTransport([orderTestRow(0)]);
    await withDatabaseEnvironment(async () => {
      await migrator.runMigrations(harness.client, orderTestMigrations);
      await migrator.runMigrations(harness.client, orderTestMigrations);
    });
    expect([...harness.ledger.values()]).toEqual([
      orderTestRow(0),
      orderTestRow(1),
      orderTestRow(2),
    ]);
    expect(harness.executed).toEqual([
      orderTestMigrations[1]?.statements[0],
      orderTestMigrations[2]?.statements[0],
    ]);
    expect(harness.rollbacks()).toBe(0);
  }, 30_000);

  it("rejects bundled backfill before executing an older missing migration", async () => {
    const migrator = await bundleMigrator();
    const harness = orderTransport([orderTestRow(0), orderTestRow(2)]);
    await expect(
      withDatabaseEnvironment(() =>
        migrator.runMigrations(harness.client, orderTestMigrations),
      ),
    ).rejects.toThrow(/earlier migration cannot be inserted/u);
    expect(harness.executed).toEqual([]);
    expect([...harness.ledger.values()]).toEqual([
      orderTestRow(0),
      orderTestRow(2),
    ]);
    expect(harness.rollbacks()).toBe(1);
    expect(
      harness.trace.findIndex((sql) => sql.includes("pg_advisory_xact_lock")),
    ).toBeLessThan(
      harness.trace.findIndex((sql) => sql.includes("WHERE version >")),
    );
  }, 30_000);

  it("detects a bundled successor committed after the initial ledger read", async () => {
    const migrator = await bundleMigrator();
    const harness = orderTransport([orderTestRow(0)], {
      concurrentSuccessor: orderTestRow(2),
    });
    await expect(
      withDatabaseEnvironment(() =>
        migrator.runMigrations(harness.client, orderTestMigrations),
      ),
    ).rejects.toThrow(/earlier migration cannot be inserted/u);
    expect(harness.executed).toEqual([]);
    expect(harness.ledger.has("0094")).toBe(false);
    expect(harness.ledger.get("0095")).toEqual(orderTestRow(2));
  }, 30_000);

  it("retains bundled checksum rejection before an upgrade", async () => {
    const migrator = await bundleMigrator();
    const harness = orderTransport([
      { ...orderTestRow(0), checksum_sha256: "f".repeat(64) },
    ]);
    await expect(
      withDatabaseEnvironment(() =>
        migrator.runMigrations(harness.client, orderTestMigrations),
      ),
    ).rejects.toThrow(/evidence does not match/u);
    expect(harness.executed).toEqual([]);
    expect(
      harness.trace.some((sql) => sql.includes("pg_advisory_xact_lock")),
    ).toBe(false);
  }, 30_000);

  it("retains bundled rejection of an unknown applied migration", async () => {
    const migrator = await bundleMigrator();
    const harness = orderTransport([
      { version: "0096", checksum_sha256: "f".repeat(64) },
    ]);
    await expect(
      withDatabaseEnvironment(() =>
        migrator.runMigrations(harness.client, orderTestMigrations),
      ),
    ).rejects.toThrow(/evidence does not match/u);
    expect(harness.executed).toEqual([]);
  }, 30_000);

  it("allows bundled retry after a failed statement rolls back", async () => {
    const migrator = await bundleMigrator();
    const harness = orderTransport([orderTestRow(0)], {
      failFirstUpgrade: true,
    });
    await expect(
      withDatabaseEnvironment(() =>
        migrator.runMigrations(harness.client, orderTestMigrations),
      ),
    ).rejects.toThrow("Simulated migration statement failure");
    expect([...harness.ledger.values()]).toEqual([orderTestRow(0)]);
    await withDatabaseEnvironment(() =>
      migrator.runMigrations(harness.client, orderTestMigrations),
    );
    expect([...harness.ledger.values()]).toEqual([
      orderTestRow(0),
      orderTestRow(1),
      orderTestRow(2),
    ]);
    expect(harness.rollbacks()).toBe(1);
  }, 30_000);

  it("still rejects malformed migration-ledger rows", async () => {
    const migrator = await bundleMigrator();
    const commandNames: string[] = [];
    const client = {
      async send(command: unknown): Promise<Readonly<Record<string, unknown>>> {
        await Promise.resolve();
        const { input, name } = commandDetails(command);
        commandNames.push(name);
        if (name !== "ExecuteStatementCommand") {
          throw new TypeError(`Unexpected RDS Data command ${name}.`);
        }
        const sql = input["sql"];
        if (typeof sql !== "string") {
          throw new TypeError("The RDS Data SQL is invalid.");
        }
        if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) return {};
        return { formattedRecords: '[{"version":"0001"}]' };
      },
    };

    await expect(
      withDatabaseEnvironment(() =>
        migrator.runMigrations(client, [
          {
            checksumSha256: "a".repeat(64),
            file: "0001_test.sql",
            statements: ["SELECT 1"],
            version: "0001",
          },
        ]),
      ),
    ).rejects.toThrow(/database returned invalid migration evidence/u);
    expect(commandNames).not.toContain("BeginTransactionCommand");
  }, 30_000);
});
