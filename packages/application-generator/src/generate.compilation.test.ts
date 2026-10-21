import * as path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { generateApplication } from "./generate.js";
import {
  createEventGenerationRequest,
  createNotesGenerationRequest,
  type EventFixturePattern,
  type FixtureMode,
  type NotesRequestOptions,
} from "./test-fixtures.js";

const expectedTypeScriptVersion = "6.0.3";
const expectedNodeTypesVersion = "24.13.3";
const expectedVitestVersion = "4.1.10";
const expectedDynamoDbVersion = "3.1101.0";
const isRepositoryCoverage =
  process.env["npm_lifecycle_event"] === "test:coverage";

const dependencyStub = `declare module "@aws-sdk/client-dynamodb" {
  export interface AttributeValue {
    readonly S?: string;
    readonly N?: string;
    readonly BOOL?: boolean;
    readonly NULL?: boolean;
    readonly L?: readonly AttributeValue[];
  }

  interface DynamoResponse {
    readonly Item?: Record<string, AttributeValue>;
    readonly Attributes?: Record<string, AttributeValue>;
  }

  export class DynamoDBClient {
    public constructor(input: Record<string, never>);
    public send(command: unknown): Promise<DynamoResponse>;
  }

  export class ConditionalCheckFailedException extends Error {}
  export class DeleteItemCommand { public constructor(input: unknown); }
  export class GetItemCommand { public constructor(input: unknown); }
  export class PutItemCommand { public constructor(input: unknown); }
  export class UpdateItemCommand { public constructor(input: unknown); }
}
`;

const scenarios = [
  {
    mode: "infrastructure-only",
    options: { mode: "infrastructure-only" },
    sourceExpected: false,
  },
  {
    mode: "user-provided",
    options: { mode: "user-provided" },
    sourceExpected: false,
  },
  {
    mode: "generated-starter",
    options: { mode: "generated-starter", operations: ["list"] },
    sourceExpected: true,
  },
  {
    mode: "complete-supported-pattern",
    options: {
      mode: "complete-supported-pattern",
      operations: ["create", "read", "update", "delete"],
    },
    sourceExpected: true,
  },
  {
    mode: "ai-assisted-custom",
    options: { mode: "ai-assisted-custom" },
    sourceExpected: true,
  },
  {
    mode: "external-artifact",
    options: { mode: "external-artifact" },
    sourceExpected: false,
  },
] as const satisfies readonly {
  readonly mode: FixtureMode;
  readonly options: NotesRequestOptions;
  readonly sourceExpected: boolean;
}[];

function objectFromJson(content: string): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(content);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a JSON object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredContent(value: unknown, filePath: string): string {
  if (
    value === null ||
    typeof value !== "object" ||
    !("content" in value) ||
    typeof value.content !== "string"
  ) {
    throw new Error(`Missing generated source content for ${filePath}.`);
  }
  return value.content;
}

function sourceContent(
  result: ReturnType<typeof generateApplication>,
  filePath: string,
): string {
  const file = result.artifact.sourceFiles.find(
    (candidate) => candidate.path === filePath,
  );
  return requiredContent(file, filePath);
}

function normalizedPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
}

function diagnosticsText(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: normalizedPath,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}

function compileGeneratedTree(
  mode: string,
  result: ReturnType<typeof generateApplication>,
): readonly ts.Diagnostic[] {
  const virtualRoot = path.resolve(
    "packages/application-generator/.generated-compile",
    mode,
  );
  const config = objectFromJson(
    sourceContent(result, "application/tsconfig.json"),
  );
  const compilerOptions = config["compilerOptions"];
  if (
    compilerOptions === null ||
    typeof compilerOptions !== "object" ||
    Array.isArray(compilerOptions)
  ) {
    throw new TypeError("Generated tsconfig requires compilerOptions.");
  }
  const converted = ts.convertCompilerOptionsFromJson(
    compilerOptions,
    virtualRoot,
    path.join(virtualRoot, "tsconfig.json"),
  );
  const options: ts.CompilerOptions = {
    ...converted.options,
    noEmit: true,
  };
  const rootNames: string[] = [];
  const virtualSources = new Map<string, string>();
  for (const file of result.artifact.sourceFiles) {
    if (file.mediaType !== "text/typescript") {
      continue;
    }
    const content = requiredContent(file, file.path);
    const rootName = path.join(
      virtualRoot,
      file.path.slice("application/".length),
    );
    rootNames.push(rootName);
    virtualSources.set(normalizedPath(rootName), content);
  }
  const stubPath = path.join(virtualRoot, "dependency-stubs.d.ts");
  const resolutionProbe = rootNames[0] ?? path.join(virtualRoot, "index.ts");
  const dynamoDbResolution = ts.resolveModuleName(
    "@aws-sdk/client-dynamodb",
    resolutionProbe,
    options,
    ts.sys,
  );
  if (dynamoDbResolution.resolvedModule === undefined) {
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
      if (content === undefined) {
        return defaultHost.getSourceFile(
          fileName,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
      }
      return ts.createSourceFile(
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

describe.skipIf(isRepositoryCoverage)(
  "generated application TypeScript compilation",
  () => {
    it.each(["contracts.repair-seed.entity"])(
      "compiles all CRUD operations with hyphenated entity %s",
      (entityContractId) => {
        const request = createNotesGenerationRequest({
          entityContractId,
          identifierSafeGenerator: true,
          operations: ["create", "read", "update", "delete"],
        });
        const result = generateApplication(request);
        expect(result.artifact.diagnostics).toEqual([]);
        expect(generateApplication(request)).toEqual(result);
        const diagnostics = compileGeneratedTree("hyphenated-entity", result);
        expect(diagnosticsText(diagnostics)).toBe("");
      },
      120_000,
    );

    it.each(
      scenarios.filter(({ mode }) =>
        ["generated-starter", "ai-assisted-custom"].includes(mode),
      ),
    )(
      "compiles every TypeScript tree emitted for $mode with the pinned toolchain",
      ({ mode, options, sourceExpected }) => {
        const result = generateApplication(
          createNotesGenerationRequest(options),
        );
        const typescriptFiles = result.artifact.sourceFiles.filter(
          (file) => file.mediaType === "text/typescript",
        );

        if (!sourceExpected) {
          expect(typescriptFiles).toEqual([]);
          return;
        }

        expect(typescriptFiles.length).toBeGreaterThan(0);
        expect(ts.version).toBe(expectedTypeScriptVersion);
        expect(
          objectFromJson(sourceContent(result, "application/package.json")),
        ).toMatchObject({
          dependencies: {
            "@aws-sdk/client-dynamodb": expectedDynamoDbVersion,
          },
          devDependencies: {
            "@types/node": expectedNodeTypesVersion,
            typescript: expectedTypeScriptVersion,
            vitest: expectedVitestVersion,
          },
          engines: { node: ">=24.0.0 <25" },
        });
        if (mode === "ai-assisted-custom") {
          expect(result.artifact.buildContracts).toEqual([]);
        } else {
          const contract = result.artifact.buildContracts[0]?.contract;
          if (contract === undefined) {
            throw new Error(`Missing build contract for ${mode}.`);
          }
          expect(contract.runtime.runtime).toBe("nodejs24.x");
          expect(
            contract.dependencies.find(
              (dependency) => dependency.name === "@types/node",
            ),
          ).toMatchObject({
            name: "@types/node",
            version: expectedNodeTypesVersion,
          });
          expect(
            contract.dependencies.find(
              (dependency) => dependency.name === "typescript",
            ),
          ).toMatchObject({
            name: "typescript",
            version: expectedTypeScriptVersion,
          });
        }

        const diagnostics = compileGeneratedTree(mode, result);
        expect(diagnosticsText(diagnostics)).toBe("");
      },
      120_000,
    );
  },
);

describe.skipIf(isRepositoryCoverage)(
  "generated curated event TypeScript compilation",
  () => {
    it.each([
      "s3-image-metadata",
      "sqs-consumer-dlq",
      "sns-fanout-consumer",
      "eventbridge-scheduled",
      "eventbridge-target",
      "step-functions-task",
    ] as const satisfies readonly EventFixturePattern[])(
      "compiles the exact curated %s event source and generated tests",
      (pattern) => {
        const result = generateApplication(
          createEventGenerationRequest({ pattern }),
        );
        expect(result.artifact.diagnostics).toEqual([]);
        expect(result.artifact.coverage.state).toBe("starter-application");
        expect(result.artifact.coverage.missingRequirements).toEqual([
          "application-build-and-tests",
          "application-security-checks",
        ]);
        expect(result.artifact.coverage.workloads[0]?.state).toBe(
          "starter-application",
        );
        expect(result.artifact.buildContracts).toHaveLength(1);

        const diagnostics = compileGeneratedTree(pattern, result);
        expect(diagnosticsText(diagnostics)).toBe("");
      },
      120_000,
    );
  },
);
