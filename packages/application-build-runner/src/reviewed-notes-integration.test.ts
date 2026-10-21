import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { generateApplication } from "@cloudmarkup/application-generator";
import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspacePrefix = join(packageRoot, ".reviewed-notes-build-");
const maximumOutputBytes = 256 * 1024;

const dynamoTypeStub = `declare module "@aws-sdk/client-dynamodb" {
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

const dynamoRuntimeStub = `export class DynamoDBClient {
  constructor() {}
  async send() { return {}; }
}
export class ConditionalCheckFailedException extends Error {}
export class DeleteItemCommand { constructor(input) { this.input = input; } }
export class GetItemCommand { constructor(input) { this.input = input; } }
export class PutItemCommand { constructor(input) { this.input = input; } }
export class UpdateItemCommand { constructor(input) { this.input = input; } }
`;

interface ProcessResult {
  readonly exitCode: number | null;
  readonly output: string;
  readonly termination: "completed" | "output-limit" | "timeout";
}

async function runPinnedNode(
  script: string,
  args: readonly string[],
  cwd: string,
): Promise<ProcessResult> {
  return await new Promise((resolveResult) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: {
        CI: "1",
        NODE_NO_WARNINGS: "1",
        SYSTEMROOT: process.env["SYSTEMROOT"] ?? "",
        TEMP: process.env["TEMP"] ?? "",
        TMP: process.env["TMP"] ?? "",
        WINDIR: process.env["WINDIR"] ?? "",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let finished = false;
    const finish = (result: ProcessResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > maximumOutputBytes) {
        child.kill("SIGKILL");
        finish({
          exitCode: null,
          output: "output limited",
          termination: "output-limit",
        });
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", () => {
      finish({
        exitCode: null,
        output: "process unavailable",
        termination: "completed",
      });
    });
    child.once("close", (exitCode) => {
      finish({ exitCode, output, termination: "completed" });
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: null, output: "timed out", termination: "timeout" });
    }, 60_000);
    timer.unref();
  });
}

async function writeExclusive(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

describe("reviewed complete notes build integration", () => {
  it("type-checks, executes generated tests, and compiles with pinned local tools", async () => {
    const workspace = await mkdtemp(workspacePrefix);
    if (!workspace.startsWith(workspacePrefix)) {
      throw new TypeError("Unexpected notes workspace path.");
    }
    try {
      const result = generateApplication(
        createNotesGenerationRequest({
          mode: "complete-supported-pattern",
          operations: ["create", "read", "update", "delete"],
        }),
      );
      for (const file of result.artifact.sourceFiles) {
        if (!("content" in file) || typeof file.content !== "string") continue;
        const destination = resolve(workspace, file.path.split("/").join(sep));
        expect(destination.startsWith(`${workspace}${sep}`)).toBe(true);
        await writeExclusive(destination, file.content);
      }

      const stubRoot = join(
        workspace,
        "application",
        "node_modules",
        "@aws-sdk",
        "client-dynamodb",
      );
      await writeExclusive(
        join(stubRoot, "package.json"),
        `${JSON.stringify({
          exports: { ".": { import: "./index.js", types: "./index.d.ts" } },
          name: "@aws-sdk/client-dynamodb",
          type: "module",
          version: "3.1101.0",
        })}\n`,
      );
      await writeExclusive(join(stubRoot, "index.d.ts"), dynamoTypeStub);
      await writeExclusive(join(stubRoot, "index.js"), dynamoRuntimeStub);
      await writeExclusive(
        join(workspace, "reviewed-vitest.config.mjs"),
        `export default { root: ".", test: { environment: "node", fileParallelism: false, maxWorkers: 1 } };\n`,
      );

      const tsc = join(packageRoot, "node_modules", "typescript", "bin", "tsc");
      const vitest = join(packageRoot, "node_modules", "vitest", "vitest.mjs");
      const checks = [
        await runPinnedNode(
          tsc,
          [
            "--project",
            "application/tsconfig.json",
            "--noEmit",
            "--types",
            "node",
          ],
          workspace,
        ),
        await runPinnedNode(
          vitest,
          [
            "run",
            "application/tests/functions/notes_handler/unit.test.ts",
            "--config",
            "reviewed-vitest.config.mjs",
            "--reporter=json",
            "--maxWorkers=1",
            "--no-file-parallelism",
            "--passWithNoTests=false",
          ],
          workspace,
        ),
        await runPinnedNode(
          vitest,
          [
            "run",
            "application/tests/functions/notes_handler/contracts.test.ts",
            "--config",
            "reviewed-vitest.config.mjs",
            "--reporter=json",
            "--maxWorkers=1",
            "--no-file-parallelism",
            "--passWithNoTests=false",
          ],
          workspace,
        ),
        await runPinnedNode(
          tsc,
          [
            "--project",
            "application/tsconfig.json",
            "--noEmit",
            "false",
            "--sourceMap",
            "false",
            "--declaration",
            "false",
            "--types",
            "node",
          ],
          workspace,
        ),
      ];
      expect(
        checks.map(({ exitCode, termination }) => ({ exitCode, termination })),
        checks.map(({ output }) => output).join("\n"),
      ).toEqual([
        { exitCode: 0, termination: "completed" },
        { exitCode: 0, termination: "completed" },
        { exitCode: 0, termination: "completed" },
        { exitCode: 0, termination: "completed" },
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 120_000);
});
