import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applicationContractRecordV1Schema,
  applicationGenerationRequestV1Schema,
  existingApplicationFileV1Schema,
  type ApplicationGenerationResultV1,
} from "@cloudmarkup/schemas";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Digest } from "./constants.js";
import { generateApplication } from "./generate.js";
import {
  CONTRACT_GOLDEN_MAX_FILENAME_LENGTH,
  projectContractGoldenPaths,
  type ContractGoldenIdentity,
} from "./contract-golden-paths.js";
import {
  createHttpNoContentFixture,
  createNotesGenerationRequest,
  type NotesRequestOptions,
} from "./test-fixtures.js";

const confirmationToken = "UPDATE_REVIEWED_GENERATION_GOLDENS";
const goldenRoot = fileURLToPath(
  new URL("../../../testdata/generation-goldens-v1/goldens/", import.meta.url),
);
const isRepositoryCoverage =
  process.env["npm_lifecycle_event"] === "test:coverage";
// Preserve the existing explicit measurement commands without replaying twenty
// non-gating generations during ordinary correctness runs.
const isGenerationBaseline = [
  "generation:baselines",
  "performance:beta",
].includes(process.env["npm_lifecycle_event"] ?? "");
const repositoryRoot = path.resolve(goldenRoot, "../../..");
const maximumGoldenRepositoryPathLength = 180;
const inventoryPath = fileURLToPath(
  new URL(
    "../../../testdata/generation-goldens-v1/fixture-inventory.json",
    import.meta.url,
  ),
);
const legacyGoldenPath = fileURLToPath(
  new URL("../fixtures/golden/notes-create-source.json", import.meta.url),
);

interface ApplicationFixture {
  readonly id: string;
  readonly options: NotesRequestOptions;
  readonly expectedCoverage: string;
  readonly expectedOperationIds: readonly string[];
  readonly semanticFragments?: Readonly<Record<string, readonly string[]>>;
}

interface FixtureInventory {
  readonly contractVersion: number;
  readonly fixtures: readonly {
    readonly id: string;
    readonly layers: readonly string[];
    readonly support: string;
  }[];
}

type GoldenCategory = "application-source" | "contracts" | "manifests";
type GoldenTree = Readonly<Record<string, string>>;

interface ProjectedContractGolden extends ContractGoldenIdentity {
  readonly content: string;
  readonly goldenPath: string;
  readonly semanticChecksum: string;
}

const applicationFixtures = [
  {
    id: "api-gateway-lambda",
    options: { mode: "generated-starter", operations: ["create"] },
    expectedCoverage: "starter-application",
    expectedOperationIds: ["operation_create_note"],
    semanticFragments: {
      "application/src/functions/notes_handler/index.ts": ["POST /notes"],
    },
  },
  {
    id: "cognito-authorized-api",
    options: { operations: ["read"] },
    expectedCoverage: "complete-supported-pattern",
    expectedOperationIds: ["operation_read_note"],
    semanticFragments: {
      "application/src/functions/notes_handler/index.ts": [
        "event.requestContext.authorizer?.jwt?.claims",
        "role_member",
      ],
    },
  },
  {
    id: "complete-supported-notes-api",
    options: { operations: ["create", "read", "update", "delete"] },
    expectedCoverage: "complete-supported-pattern",
    expectedOperationIds: [
      "operation_create_note",
      "operation_delete_note",
      "operation_read_note",
      "operation_update_note",
    ],
  },
  {
    id: "generated-starter-lambda",
    options: { mode: "generated-starter", operations: ["create"] },
    expectedCoverage: "starter-application",
    expectedOperationIds: ["operation_create_note"],
  },
  {
    id: "lambda-dynamodb-read-only",
    options: { operations: ["read"] },
    expectedCoverage: "complete-supported-pattern",
    expectedOperationIds: ["operation_read_note"],
    semanticFragments: {
      "application/src/functions/notes_handler/generated/operations/operation_read_note.ts":
        ["GetItemCommand"],
    },
  },
  {
    id: "lambda-dynamodb-read-write",
    options: { operations: ["create", "read", "update", "delete"] },
    expectedCoverage: "complete-supported-pattern",
    expectedOperationIds: [
      "operation_create_note",
      "operation_delete_note",
      "operation_read_note",
      "operation_update_note",
    ],
    semanticFragments: {
      "application/src/functions/notes_handler/generated/operations/operation_create_note.ts":
        ["PutItemCommand"],
      "application/src/functions/notes_handler/generated/operations/operation_delete_note.ts":
        ["DeleteItemCommand"],
      "application/src/functions/notes_handler/generated/operations/operation_update_note.ts":
        ["UpdateItemCommand"],
    },
  },
  {
    id: "minimal-lambda-infrastructure-only",
    options: { mode: "infrastructure-only" },
    expectedCoverage: "infrastructure-only",
    expectedOperationIds: [],
  },
  {
    id: "multiple-downstream-dependencies",
    options: { operations: ["create", "read"], separateTables: true },
    expectedCoverage: "complete-supported-pattern",
    expectedOperationIds: ["operation_create_note", "operation_read_note"],
    semanticFragments: {
      "application/src/functions/notes_handler/generated/bindings.ts": [
        "NOTES_ARCHIVE_TABLE_NAME",
        "NOTES_TABLE_NAME",
      ],
    },
  },
  {
    id: "multiple-trigger-compatible",
    options: { operations: ["create", "read"] },
    expectedCoverage: "complete-supported-pattern",
    expectedOperationIds: ["operation_create_note", "operation_read_note"],
  },
  {
    id: "naming-collisions",
    options: { workloadId: "team:notes" },
    expectedCoverage: "complete-supported-pattern",
    expectedOperationIds: ["operation_create_note"],
  },
  {
    id: "user-provided-lambda-artifact",
    options: { mode: "user-provided" },
    expectedCoverage: "custom-implementation-required",
    expectedOperationIds: [],
  },
] as const satisfies readonly ApplicationFixture[];

const dependencyStub = `declare module "@aws-sdk/client-dynamodb" {
  export interface AttributeValue {
    readonly S?: string;
    readonly N?: string;
    readonly BOOL?: boolean;
    readonly NULL?: boolean;
    readonly L?: readonly AttributeValue[];
  }
  interface DynamoResponse { readonly Item?: Record<string, AttributeValue>; readonly Attributes?: Record<string, AttributeValue>; }
  export class DynamoDBClient { public constructor(input: Record<string, never>); public send(command: unknown): Promise<DynamoResponse>; }
  export class ConditionalCheckFailedException extends Error {}
  export class DeleteItemCommand { public constructor(input: unknown); }
  export class GetItemCommand { public constructor(input: unknown); }
  export class PutItemCommand { public constructor(input: unknown); }
  export class UpdateItemCommand { public constructor(input: unknown); }
}
`;

function requiredContent(value: unknown, filePath: string): string {
  if (
    value === null ||
    typeof value !== "object" ||
    !("content" in value) ||
    typeof value.content !== "string"
  ) {
    throw new Error(`Missing generated content for ${filePath}.`);
  }
  return value.content;
}

function sourceContent(
  result: ApplicationGenerationResultV1,
  filePath: string,
): string {
  const file = result.artifact.sourceFiles.find(
    (candidate) => candidate.path === filePath,
  );
  return requiredContent(file, filePath);
}

function diagnosticCodes(result: ApplicationGenerationResultV1): string[] {
  return result.artifact.diagnostics.map(({ code }) => code);
}

function normalizedPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
}

function compileGeneratedTree(
  fixtureId: string,
  result: ApplicationGenerationResultV1,
): readonly ts.Diagnostic[] {
  const typescriptFiles = result.artifact.sourceFiles.filter(
    (file) => file.mediaType === "text/typescript",
  );
  if (typescriptFiles.length === 0) return [];
  const virtualRoot = path.resolve(
    "packages/application-generator/.prompt30-compile",
    fixtureId,
  );
  const tsconfig = JSON.parse(
    sourceContent(result, "application/tsconfig.json"),
  ) as Readonly<Record<string, unknown>>;
  const converted = ts.convertCompilerOptionsFromJson(
    tsconfig["compilerOptions"],
    virtualRoot,
    path.join(virtualRoot, "tsconfig.json"),
  );
  const options: ts.CompilerOptions = {
    ...converted.options,
    noEmit: true,
    types: ["node"],
  };
  const virtualSources = new Map<string, string>();
  const rootNames = typescriptFiles.map((file) => {
    const rootName = path.join(
      virtualRoot,
      file.path.slice("application/".length),
    );
    virtualSources.set(
      normalizedPath(rootName),
      requiredContent(file, file.path),
    );
    return rootName;
  });
  const resolutionProbe = rootNames[0] ?? path.join(virtualRoot, "index.ts");
  if (
    ts.resolveModuleName(
      "@aws-sdk/client-dynamodb",
      resolutionProbe,
      options,
      ts.sys,
    ).resolvedModule === undefined
  ) {
    const stubPath = path.join(virtualRoot, "dependency-stubs.d.ts");
    rootNames.push(stubPath);
    virtualSources.set(normalizedPath(stubPath), dependencyStub);
  }
  const defaultHost = ts.createCompilerHost(options, true);
  const virtualRootKey = normalizedPath(virtualRoot);
  const host: ts.CompilerHost = {
    ...defaultHost,
    getCurrentDirectory: () => virtualRoot,
    directoryExists: (directoryName) =>
      normalizedPath(directoryName).startsWith(virtualRootKey) ||
      (defaultHost.directoryExists?.(directoryName) ?? false),
    fileExists: (fileName) =>
      virtualSources.has(normalizedPath(fileName)) ||
      defaultHost.fileExists(fileName),
    readFile: (fileName) =>
      virtualSources.get(normalizedPath(fileName)) ??
      defaultHost.readFile(fileName),
    getSourceFile: (
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      const content = virtualSources.get(normalizedPath(fileName));
      return content === undefined
        ? defaultHost.getSourceFile(
            fileName,
            languageVersion,
            onError,
            shouldCreateNewSourceFile,
          )
        : ts.createSourceFile(
            fileName,
            content,
            languageVersion,
            true,
            ts.ScriptKind.TS,
          );
    },
  };
  const program = ts.createProgram({ host, options, rootNames });
  return [...converted.errors, ...ts.getPreEmitDiagnostics(program)];
}

function diagnosticsText(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: normalizedPath,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}

function projectedContractGoldens(
  result: ApplicationGenerationResultV1,
): readonly ProjectedContractGolden[] {
  const records = result.artifact.sourceFiles
    .filter(
      (file) =>
        file.path.startsWith("application/contracts/") &&
        file.disposition !== "unchanged" &&
        file.disposition !== "preserve",
    )
    .map((file) => {
      const content = requiredContent(file, file.path);
      const contract = applicationContractRecordV1Schema.parse(
        JSON.parse(content) as unknown,
      );
      return {
        canonicalPath: file.path,
        checksum: file.checksum,
        content,
        contractId: contract.contractId,
        contractVersion: contract.contractVersion,
        semanticChecksum: file.semanticChecksum,
      };
    });
  const projectedPaths = projectContractGoldenPaths(records);
  const recordsByCanonicalPath = new Map<string, (typeof records)[number]>();
  for (const record of records)
    recordsByCanonicalPath.set(record.canonicalPath, record);
  return [...projectedPaths].map(([canonicalPath, goldenPath]) => {
    const record = recordsByCanonicalPath.get(canonicalPath);
    if (record === undefined) {
      throw new Error(
        `Missing Prompt 30 contract record for ${canonicalPath}.`,
      );
    }
    return { ...record, goldenPath };
  });
}

function addGoldenFile(
  tree: Record<string, string>,
  relativePath: string,
  content: string,
  sourcePath: string,
): void {
  if (Object.hasOwn(tree, relativePath)) {
    throw new Error(
      `Prompt 30 golden path collision at ${relativePath} from ${sourcePath}.`,
    );
  }
  tree[relativePath] = content;
}

function applicationArtifactGoldenProjection(
  result: ApplicationGenerationResultV1,
) {
  const artifact = result.artifact;
  const sourceFilesByPath = new Map(
    artifact.sourceFiles.map((file) => [file.path, file]),
  );
  return {
    ...artifact,
    diff: {
      ...artifact.diff,
      files: artifact.diff.files.map((file) => {
        const sourceFile = sourceFilesByPath.get(file.path);
        expect(sourceFile).toBeDefined();
        expect(file.sourceReferences).toEqual(sourceFile?.sourceReferences);
        const { sourceReferences, ...metadata } = file;
        void sourceReferences;
        return metadata;
      }),
    },
    sourceFiles: artifact.sourceFiles.map((file) => {
      // These pins remain once at the artifact root. Assert equality before
      // omitting each repeated copy so provenance drift still fails the test.
      const {
        generator,
        pattern,
        runtime,
        solutionRevisionId,
        template,
        ...provenance
      } = file.provenance;
      expect({
        generator,
        pattern,
        runtime,
        solutionRevisionId,
        template,
      }).toEqual({
        generator: artifact.generator,
        pattern: artifact.pattern,
        runtime: artifact.runtime,
        solutionRevisionId: artifact.solutionRevisionId,
        template: artifact.template,
      });
      if (!("content" in file)) return { ...file, provenance };
      const { content, ...metadata } = file;
      void content;
      return { ...metadata, provenance };
    }),
  };
}

function applicationTrees(
  fixture: ApplicationFixture,
  result: ApplicationGenerationResultV1,
): Readonly<Record<GoldenCategory, GoldenTree>> {
  const applicationSource: Record<string, string> = {};
  const contracts: Record<string, string> = {};
  const projectedContracts = projectedContractGoldens(result);
  const projectedByCanonicalPath = new Map(
    projectedContracts.map((contract) => [
      contract.canonicalPath,
      contract.goldenPath,
    ]),
  );
  for (const file of result.artifact.sourceFiles) {
    if (file.disposition === "unchanged" || file.disposition === "preserve") {
      continue;
    }
    const content = requiredContent(file, file.path);
    if (file.path.startsWith("application/contracts/")) {
      const goldenPath = projectedByCanonicalPath.get(file.path);
      if (goldenPath === undefined) {
        throw new Error(`Missing compact golden path for ${file.path}.`);
      }
      addGoldenFile(contracts, goldenPath, content, file.path);
    } else if (!file.path.startsWith("application/build-contracts/")) {
      addGoldenFile(applicationSource, file.path, content, file.path);
    }
  }
  return {
    "application-source": {
      ...applicationSource,
      "semantic-summary.md": semanticSummary(fixture, result),
    },
    contracts: {
      ...contracts,
      "semantic-summary.md": contractSummary(fixture, projectedContracts),
    },
    manifests: {
      "artifact.json": `${JSON.stringify(
        {
          contractVersion: result.contractVersion,
          artifact: applicationArtifactGoldenProjection(result),
          artifactDigest: result.artifactDigest,
        },
        undefined,
        2,
      )}\n`,
      "semantic-summary.md": semanticSummary(fixture, result),
    },
  };
}

function semanticSummary(
  fixture: ApplicationFixture,
  result: ApplicationGenerationResultV1,
): string {
  const coverage = result.artifact.coverage.workloads[0];
  const lines = [
    `# Application semantic summary: ${fixture.id}`,
    "",
    `- Artifact digest: \`${result.artifactDigest}\``,
    `- Coverage: \`${result.artifact.coverage.state}\``,
    `- Generated file records: ${String(result.artifact.sourceFiles.length)}`,
    `- Build contracts: ${String(result.artifact.buildContracts.length)}`,
    `- Diagnostics: ${String(result.artifact.diagnostics.length)}`,
    "",
    "## Represented operations",
    "",
    ...(coverage?.representedOperationIds.length === 0
      ? ["- None"]
      : (coverage?.representedOperationIds.map((id) => `- \`${id}\``) ?? [
          "- None",
        ])),
    "",
    "## Represented tests",
    "",
    ...(coverage?.representedTestIds.length === 0
      ? ["- None"]
      : (coverage?.representedTestIds.map((id) => `- \`${id}\``) ?? [
          "- None",
        ])),
    "",
    "## File inventory",
    "",
    ...result.artifact.sourceFiles.map(
      (file) => `- \`${file.path}\`: \`${file.ownership}/${file.disposition}\``,
    ),
    "",
  ];
  return lines.join("\n");
}

function contractSummary(
  fixture: ApplicationFixture,
  contractFiles: readonly ProjectedContractGolden[],
): string {
  return [
    `# Contract semantic summary: ${fixture.id}`,
    "",
    `- Canonical contract files: ${String(contractFiles.length)}`,
    ...contractFiles.map(
      (file) =>
        `- \`${file.goldenPath}\` ← \`${file.canonicalPath}\`: checksum \`${file.checksum}\`; semantic checksum \`${file.semanticChecksum}\``,
    ),
    "",
  ].join("\n");
}

function updateMode(): {
  readonly category?: GoldenCategory;
  readonly update: boolean;
} {
  const category = process.env["CLOUDMARKUP_GENERATION_GOLDEN_CATEGORY"];
  if (
    category !== "application-source" &&
    category !== "contracts" &&
    category !== "manifests"
  ) {
    return { update: false };
  }
  if (
    process.env["CLOUDMARKUP_GENERATION_GOLDEN_CONFIRM"] !== confirmationToken
  ) {
    throw new Error("Golden update requires the exact confirmation token.");
  }
  if (
    (process.env["CLOUDMARKUP_GENERATION_GOLDEN_SUMMARY"] ?? "").trim() === ""
  ) {
    throw new Error("Golden update requires a nonempty reviewer summary.");
  }
  return { category, update: true };
}

function categoryPath(category: GoldenCategory): string {
  return category === "manifests" ? "manifests/application" : category;
}

function assertSafeGoldenRoot(
  fixtureId: string,
  category: GoldenCategory,
): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fixtureId)) {
    throw new Error(`Unsafe fixture ID ${fixtureId}.`);
  }
  const root = path.resolve(goldenRoot, fixtureId, categoryPath(category));
  const allowedRoot = `${path.resolve(goldenRoot)}${path.sep}`;
  if (!`${root}${path.sep}`.startsWith(allowedRoot)) {
    throw new Error(`Unsafe golden root ${root}.`);
  }
  return root;
}

async function readTree(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else
        tree[path.relative(root, target).split(path.sep).join("/")] =
          await readFile(target, "utf8");
    }
  }
  await visit(root);
  return tree;
}

interface MaterializedGoldenFile {
  readonly content: string;
  readonly target: string;
}

const windowsReservedName =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const windowsInvalidCharacters = /[<>:"|?*]/u;
const fullDigestFilename = /[a-f0-9]{64}/iu;

function hasWindowsInvalidCharacter(value: string): boolean {
  if (windowsInvalidCharacters.test(value)) return true;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function planMaterialization(
  root: string,
  tree: GoldenTree,
): readonly MaterializedGoldenFile[] {
  const resolvedRoot = path.resolve(root);
  const rootRelativeToGoldens = path.relative(
    path.resolve(goldenRoot),
    resolvedRoot,
  );
  const repositoryGoldenRoot =
    rootRelativeToGoldens === "" ||
    (!path.isAbsolute(rootRelativeToGoldens) &&
      rootRelativeToGoldens !== ".." &&
      !rootRelativeToGoldens.startsWith(`..${path.sep}`));
  const portablePaths = new Map<string, string>();
  return Object.entries(tree)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([relative, content]) => {
      const segments = relative.split("/");
      if (
        relative === "" ||
        relative !== relative.normalize("NFC") ||
        relative.includes("\\") ||
        path.posix.isAbsolute(relative) ||
        path.win32.isAbsolute(relative) ||
        segments.some(
          (segment) =>
            segment === "" ||
            segment === "." ||
            segment === ".." ||
            hasWindowsInvalidCharacter(segment) ||
            /[ .]$/u.test(segment) ||
            windowsReservedName.test(segment),
        )
      ) {
        throw new Error(`Unsafe Prompt 30 golden tree path: ${relative}.`);
      }
      const filename = segments.at(-1) ?? "";
      if (
        filename.length > CONTRACT_GOLDEN_MAX_FILENAME_LENGTH ||
        fullDigestFilename.test(filename)
      ) {
        throw new Error(`Unsafe Prompt 30 golden filename: ${relative}.`);
      }
      const portablePath = relative.toLowerCase();
      const existing = portablePaths.get(portablePath);
      if (existing !== undefined) {
        throw new Error(
          `Duplicate Windows Prompt 30 golden path: ${existing} and ${relative}.`,
        );
      }
      portablePaths.set(portablePath, relative);
      const target = path.resolve(resolvedRoot, ...segments);
      const targetRelativeToRoot = path.relative(resolvedRoot, target);
      if (
        targetRelativeToRoot === "" ||
        path.isAbsolute(targetRelativeToRoot) ||
        targetRelativeToRoot === ".." ||
        targetRelativeToRoot.startsWith(`..${path.sep}`)
      ) {
        throw new Error(`Prompt 30 golden path escapes its root: ${relative}.`);
      }
      if (repositoryGoldenRoot) {
        const repositoryRelative = path
          .relative(repositoryRoot, target)
          .split(path.sep)
          .join("/");
        if (
          path.isAbsolute(repositoryRelative) ||
          repositoryRelative === ".." ||
          repositoryRelative.startsWith("../") ||
          repositoryRelative.length > maximumGoldenRepositoryPathLength
        ) {
          throw new Error(
            `Prompt 30 repository golden path exceeds its safe boundary (${String(repositoryRelative.length)}/${String(maximumGoldenRepositoryPathLength)}): ${repositoryRelative}.`,
          );
        }
      }
      return { content, target };
    });
}

async function materializePlan(
  plan: readonly MaterializedGoldenFile[],
): Promise<void> {
  for (const { content, target } of plan) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function materializeTree(root: string, tree: GoldenTree): Promise<void> {
  await materializePlan(planMaterialization(root, tree));
}

async function replaceTree(root: string, tree: GoldenTree): Promise<void> {
  const plan = planMaterialization(root, tree);
  await rm(root, { recursive: true, force: true });
  await materializePlan(plan);
}

async function compareOrUpdateTree(
  fixtureId: string,
  category: GoldenCategory,
  actual: GoldenTree,
  update: boolean,
): Promise<void> {
  const root = assertSafeGoldenRoot(fixtureId, category);
  if (update) {
    await replaceTree(root, actual);
  }
  expect(actual).toEqual(await readTree(root));
}

async function assertCleanDirectoryRoundtrip(tree: GoldenTree): Promise<void> {
  const root = await mkdtemp(
    path.join(tmpdir(), "cloudmarkup-prompt30-roundtrip-"),
  );
  try {
    await materializeTree(root, tree);
    // Generation reproducibility is checked with two independent requests.
    // This helper checks exact filesystem bytes rather than comparing two
    // identical writes that could both omit or corrupt the same content.
    expect(await readTree(root)).toEqual(tree);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function assertSourceIntegrity(result: ApplicationGenerationResultV1): void {
  const serialized = canonicalJson(result);
  for (const forbidden of [
    "secret_fixture_marker_never_embed",
    "SECRET_DO_NOT_READ",
    "child_process",
    "eval(",
    "exec(",
    "C:\\\\",
    "file://",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  for (const file of result.artifact.sourceFiles) {
    if (!("content" in file)) continue;
    expect(file.content).not.toContain("\r");
    expect(file.checksum).toBe(sha256Digest(file.content));
    expect(new TextEncoder().encode(file.content)).toHaveLength(file.sizeBytes);
    if (file.mediaType === "application/json") {
      expect(() => {
        const parsed: unknown = JSON.parse(file.content);
        void parsed;
      }).not.toThrow();
    }
    // The fixture's full virtual program checks every TypeScript source below,
    // including syntax diagnostics; no separate per-file transpile is needed.
  }
}

function legacyGoldenProjection(result: ApplicationGenerationResultV1) {
  return {
    artifactDigest: result.artifactDigest,
    coverageDigest: result.artifact.coverageDigest,
    sourceManifestDigest: result.artifact.sourceManifestDigest,
    coverage: result.artifact.coverage,
    buildContracts: result.artifact.buildContracts.map((entry) => ({
      workloadId: entry.contract.workloadId,
      contractDigest: entry.contractDigest,
      entrypoint: entry.contract.entrypoint,
      artifactPath: entry.contract.expectedArtifact.path,
    })),
    files: result.artifact.sourceFiles.map((file) => ({
      path: file.path,
      checksum: file.checksum,
      semanticChecksum: file.semanticChecksum,
      sizeBytes: file.sizeBytes,
      ownership: file.ownership,
      disposition: file.disposition,
    })),
  };
}

describe.skipIf(isRepositoryCoverage)(
  "Prompt 30 application generation goldens",
  () => {
    it("covers the exact supported application fixture inventory", async () => {
      const inventory = JSON.parse(
        await readFile(inventoryPath, "utf8"),
      ) as FixtureInventory;
      const expected = inventory.fixtures
        .filter(
          (fixture) =>
            fixture.support === "supported" &&
            fixture.layers.includes("application"),
        )
        .map(({ id }) => id)
        .sort();
      expect(inventory.contractVersion).toBe(1);
      expect(applicationFixtures.map(({ id }) => id).sort()).toEqual(expected);
    });

    it("uses compact contract golden names while retaining complete canonical metadata", () => {
      const fixture = applicationFixtures.find(
        ({ id }) => id === "complete-supported-notes-api",
      );
      if (fixture === undefined)
        throw new Error("Missing complete notes fixture.");
      const result = generateApplication(
        createNotesGenerationRequest(fixture.options),
      );
      const projected = projectedContractGoldens(result);
      const tree = applicationTrees(fixture, result).contracts;
      expect(projected.length).toBeGreaterThan(0);
      expect(
        Object.keys(tree)
          .filter((filePath) => filePath !== "semantic-summary.md")
          .sort(),
      ).toEqual(projected.map(({ goldenPath }) => goldenPath).sort());
      expect(new Set(projected.map(({ goldenPath }) => goldenPath)).size).toBe(
        projected.length,
      );
      const summary = tree["semantic-summary.md"] ?? "";
      for (const contract of projected) {
        expect(contract.goldenPath).toMatch(
          /^[a-z0-9]+(?:-[a-z0-9]+)*(?:-[a-f0-9]{12})?\.json$/u,
        );
        expect(contract.goldenPath.length).toBeLessThanOrEqual(
          CONTRACT_GOLDEN_MAX_FILENAME_LENGTH,
        );
        expect(contract.goldenPath).not.toMatch(/[a-f0-9]{64}/u);
        expect(contract.goldenPath).not.toContain("/");
        expect(contract.goldenPath).not.toContain("\\");
        expect(tree[contract.goldenPath]).toBe(contract.content);
        expect(sha256Digest(contract.content)).toBe(contract.checksum);
        expect(result.artifact.sourceManifest.files).toContainEqual(
          expect.objectContaining({
            checksum: contract.checksum,
            path: contract.canonicalPath,
            semanticChecksum: contract.semanticChecksum,
          }),
        );
        expect(summary).toContain(`\`${contract.goldenPath}\``);
        expect(summary).toContain(`\`${contract.canonicalPath}\``);
        expect(summary).toContain(`\`${contract.checksum}\``);
        expect(summary).toContain(`\`${contract.semanticChecksum}\``);
      }
    });

    it("rejects an unsafe golden key before replacing the reviewed category", async () => {
      const root = await mkdtemp(
        path.join(tmpdir(), "cloudmarkup-prompt30-reject-"),
      );
      const sentinel = path.join(root, "reviewed.json");
      try {
        await writeFile(sentinel, "reviewed\n", "utf8");
        await expect(
          replaceTree(root, {
            "../escape.json": "unsafe\n",
          }),
        ).rejects.toThrow(/unsafe prompt 30 golden tree path/i);
        await expect(
          replaceTree(root, {
            "NUL.json": "unsafe\n",
          }),
        ).rejects.toThrow(/unsafe prompt 30 golden tree path/i);
        await expect(
          replaceTree(root, {
            "contract:stream.json": "unsafe\n",
          }),
        ).rejects.toThrow(/unsafe prompt 30 golden tree path/i);
        expect(await readFile(sentinel, "utf8")).toBe("reviewed\n");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it.each([
      applicationFixtures[0],
      {
        ...applicationFixtures[1],
        semanticFragments: {
          ...applicationFixtures[1].semanticFragments,
          ...applicationFixtures[4].semanticFragments,
        },
      },
      {
        ...applicationFixtures[2],
        semanticFragments: applicationFixtures[5].semanticFragments,
      },
      ...applicationFixtures.slice(6),
    ] as const)(
      "$id matches reviewed source, contract, and manifest trees",
      async (fixture: ApplicationFixture) => {
        const first = generateApplication(
          createNotesGenerationRequest(fixture.options),
        );
        const second = generateApplication(
          createNotesGenerationRequest(fixture.options),
        );
        expect(first).toEqual(second);
        expect(first.artifact.coverage.state).toBe(fixture.expectedCoverage);
        expect(
          first.artifact.coverage.workloads[0]?.representedOperationIds,
        ).toEqual(fixture.expectedOperationIds);
        assertSourceIntegrity(first);
        for (const [filePath, fragments] of Object.entries(
          fixture.semanticFragments ?? {},
        )) {
          const content = sourceContent(first, filePath);
          for (const fragment of fragments) expect(content).toContain(fragment);
        }
        if (!isRepositoryCoverage) {
          const diagnostics = compileGeneratedTree(fixture.id, first);
          expect(diagnosticsText(diagnostics)).toBe("");
        }
        if (
          first.artifact.sourceFiles.some(
            (file) => file.path === "application/README.md",
          )
        ) {
          const readme = sourceContent(first, "application/README.md");
          for (const expected of [
            first.artifact.solutionRevisionId,
            first.artifact.generator.id,
            first.artifact.generator.version,
            first.artifact.template.id,
            first.artifact.runtime.id,
            first.artifact.pattern.id,
            first.artifact.sourceManifest.catalog.id,
          ]) {
            expect(readme).toContain(expected);
          }
        }
        const trees = applicationTrees(fixture, first);
        const update = updateMode();
        for (const category of [
          "application-source",
          "contracts",
          "manifests",
        ] as const) {
          if (!update.update || update.category === category) {
            await compareOrUpdateTree(
              fixture.id,
              category,
              trees[category],
              update.update,
            );
          }
        }
        await assertCleanDirectoryRoundtrip({
          ...trees["application-source"],
          ...Object.fromEntries(
            Object.entries(trees.contracts).map(([key, value]) => [
              `contracts/${key}`,
              value,
            ]),
          ),
        });
        if (fixture.id === "naming-collisions") {
          expect(
            first.artifact.sourceFiles.map(({ path: filePath }) => filePath),
          ).toEqual(expect.not.arrayContaining([expect.stringContaining(":")]));
          expect(first.artifact.buildContracts[0]?.contract.workloadId).toBe(
            "team:notes",
          );
        }
      },
      120_000,
    );

    it("fails closed for invalid, unresolved, colliding, and incompatible inputs", () => {
      const cases = [
        [
          { invalidWorkloadShape: true },
          "APPLICATION_WORKLOAD_SHAPE_UNSUPPORTED",
        ],
        [
          { invalidTestTargetFor: "create" as const },
          "APPLICATION_COMPLETE_TESTS_INCOMPLETE",
        ],
        [
          { unresolvedBehavior: true },
          "APPLICATION_COMPLETE_BEHAVIOR_UNRESOLVED",
        ],
        [
          {
            operations: ["create", "read"] as const,
            incompatibleMultipleInputs: true,
          },
          "APPLICATION_MULTIPLE_TRIGGER_INCOMPATIBLE",
        ],
        [
          {
            operations: ["create", "read"] as const,
            collidingOperationPathKeys: true,
          },
          "APPLICATION_DISPATCH_KEY_COLLISION",
        ],
        [
          { normalizedTargetKeyTamper: true },
          "APPLICATION_NORMALIZED_RESOURCE_MISMATCH",
        ],
      ] as const;
      for (const [options, code] of cases) {
        const result = generateApplication(
          createNotesGenerationRequest(options),
        );
        expect(diagnosticCodes(result)).toContain(code);
        expect(result.artifact.coverage.state).toBe("target-unsupported");
        expect(result.artifact.buildContracts).toEqual([]);
      }
      const malformed = structuredClone(createNotesGenerationRequest());
      const malformedRecord = malformed as unknown as Record<string, unknown>;
      delete malformedRecord["contractVersion"];
      expect(() =>
        applicationGenerationRequestV1Schema.parse(malformed),
      ).toThrow();
      expect(() => generateApplication(malformed)).toThrow();
    }, 30_000);

    it("preserves user-owned source and reports generated-path conflicts", () => {
      const pathValue = "application/src/functions/notes_handler/index.ts";
      const existing = existingApplicationFileV1Schema.parse({
        path: pathValue,
        mediaType: "text/typescript",
        ownership: "user-owned",
        currentChecksum: sha256Digest("user-owned current source"),
        semanticChecksum: sha256Digest("user-owned semantic source"),
        sizeBytes: 25,
      });
      const result = generateApplication(
        createNotesGenerationRequest({ existingFiles: [existing] }),
      );
      expect(
        result.artifact.sourceFiles.some((file) => file.path === pathValue),
      ).toBe(false);
      expect(result.artifact.diff.files).toContainEqual(
        expect.objectContaining({
          path: pathValue,
          change: "conflict",
          ownership: "user-owned",
        }),
      );
      expect(diagnosticCodes(result)).toContain("APPLICATION_SOURCE_CONFLICT");
      expect(result.artifact.buildContracts).toEqual([]);
    }, 30_000);

    it.skipIf(!isGenerationBaseline)(
      "records non-gating small and medium generation baselines",
      () => {
        const scenarios = [
          ["small", { mode: "generated-starter", operations: ["create"] }],
          [
            "medium",
            {
              operations: ["create", "read", "update", "delete"],
              separateTables: true,
            },
          ],
        ] as const satisfies readonly [string, NotesRequestOptions][];
        const measurements = scenarios.map(([name, options]) => {
          const started = performance.now();
          let result: ApplicationGenerationResultV1 | undefined;
          for (let index = 0; index < 10; index += 1) {
            result = generateApplication(createNotesGenerationRequest(options));
          }
          return {
            name,
            iterations: 10,
            elapsedMilliseconds:
              Math.round((performance.now() - started) * 100) / 100,
            files: result?.artifact.sourceFiles.length ?? 0,
          };
        });
        console.info(
          "Prompt 30 application performance baseline",
          measurements,
        );
        expect(measurements.every(({ files }) => files > 0)).toBe(true);
      },
      60_000,
    );

    it("refreshes the legacy source inventory only with the manifests update gate", async () => {
      const update = updateMode();
      if (update.update && update.category !== "manifests") {
        return;
      }
      const sources = [
        [legacyGoldenPath, createNotesGenerationRequest()],
        [
          fileURLToPath(
            new URL(
              "../fixtures/golden/http-no-content-1.0-source.json",
              import.meta.url,
            ),
          ),
          createHttpNoContentFixture(),
        ],
        [
          fileURLToPath(
            new URL(
              "../fixtures/golden/notes-identifier-1.1-source.json",
              import.meta.url,
            ),
          ),
          createNotesGenerationRequest({
            identifierSafeGenerator: true,
            entityContractId: "contracts.repair-seed.entity",
            operations: ["create", "read", "update", "delete"],
          }),
        ],
      ] as const;
      for (const [sourcePath, request] of sources) {
        const projection = legacyGoldenProjection(generateApplication(request));
        if (update.update && update.category === "manifests") {
          await writeFile(
            sourcePath,
            `${JSON.stringify(projection, undefined, 2)}\n`,
            "utf8",
          );
        }
        expect(projection).toEqual(
          JSON.parse(await readFile(sourcePath, "utf8")) as unknown,
        );
      }
    }, 30_000);
  },
);
