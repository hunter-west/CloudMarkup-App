import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { awsCatalogV1, AWS_CATALOG_DIGEST_V1 } from "@cloudmarkup/provider-aws";
import {
  applyGraphCommand,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import {
  goCompilationResultV1Schema,
  solutionExportCompilerArgs,
  SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS,
} from "@cloudmarkup/solution-export-workflow";
import { expect, it } from "vitest";
import { createPinnedSolutionExportCompilerExecutor } from "./pinned-export-compiler.js";

const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
it.skipIf(executablePath === undefined || executableSha256 === undefined)(
  "compiles the real canonical SQS fixture reproducibly and removes every temporary invocation",
  async () => {
    const source = JSON.parse(
      await readFile(
        new URL(
          "../../../../packages/architecture-cli/src/fixtures/aws-eventing/compiler-v1/sqs-consumer-dlq/source.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const root = await mkdtemp(
      join(tmpdir(), "cloudmarkup-real-compiler-test-"),
    );
    try {
      const executor = createPinnedSolutionExportCompilerExecutor({
        executablePath: executablePath ?? "",
        executableSha256: executableSha256 ?? "",
        temporaryRoot: root,
      });
      const command = {
        executable: "cloudmarkup-iac" as const,
        args: solutionExportCompilerArgs("terraform"),
        files: {
          "architecture.json": JSON.stringify(source["architectureDocument"]),
          "solution-revision.json": JSON.stringify(source["solutionRevision"]),
          "workload.json": JSON.stringify(source["workloadBehavior"]),
        },
        limits: SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS,
        signal: new AbortController().signal,
      };
      const first = await executor.execute(command);
      expect(first).toMatchObject({
        termination: "completed",
        exitCode: 0,
        stderr: "",
      });
      const result = goCompilationResultV1Schema.parse(
        JSON.parse(first.stdout) as unknown,
      );
      expect(
        (result.diagnostics ?? []).filter(
          ({ severity }) => severity === "error",
        ),
      ).toEqual([]);
      expect(result.artifact?.files?.length).toBeGreaterThan(0);
      expect(first.stdout).toContain("aws_sqs_queue");
      expect(await executor.execute(command)).toEqual(first);

      const original = architectureDocumentV3Schema.parse(
        source["architectureDocument"],
      );
      // Exercise both renderers against their current reviewed catalog.
      const document = architectureDocumentV3Schema.parse({
        ...original,
        catalog: {
          id: awsCatalogV1.artifact.catalog.id,
          version: awsCatalogV1.artifact.catalog.version,
          digest: AWS_CATALOG_DIGEST_V1,
        },
      });
      const queue = document.nodes.find(({ id }) => id === "queue_source");
      if (queue === undefined)
        throw new Error("The fixture requires a source queue.");
      const edited = applyGraphCommand(document, {
        schemaVersion: 1,
        commandId: "command_export_queue_retention",
        inverseCommandId: "command_export_queue_retention_inverse",
        origin: "user",
        target: {
          architectureId: document.architectureId,
          documentId: document.documentId,
          revisionId: document.revision.revisionId,
        },
        kind: "update-node-configuration",
        nodeId: queue.id,
        expectedConfiguration: queue.semantic.configuration,
        configuration: {
          ...queue.semantic.configuration,
          values: {
            ...queue.semantic.configuration.values,
            messageRetentionSeconds: { kind: "integer", value: 604800 },
          },
        },
      }).document;
      const unbound = await executor.execute({
        ...command,
        files: {
          ...command.files,
          "architecture.json": JSON.stringify(edited),
        },
      });
      const rejected = goCompilationResultV1Schema.parse(
        JSON.parse(unbound.stdout) as unknown,
      );
      expect(
        (rejected.diagnostics ?? []).some(
          ({ severity }) => severity === "error",
        ),
      ).toBe(true);
      expect(rejected.artifact).toBeUndefined();

      const manifest = solutionRevisionManifestV1Schema.parse(
        source["solutionRevision"],
      );
      const frozen = {
        ...manifest,
        versions: { ...manifest.versions, catalog: document.catalog },
        architecture: {
          ...manifest.architecture,
          contentHash: getArchitectureDocumentContentHash(edited),
          documentHash: getArchitectureDocumentCanonicalHash(edited),
          visualHash: getArchitectureDocumentVisualHash(edited),
        },
      };
      for (const target of ["terraform", "cloudformation"] as const) {
        const output = await executor.execute({
          ...command,
          args: solutionExportCompilerArgs(target),
          files: {
            ...command.files,
            "architecture.json": JSON.stringify(edited),
            "solution-revision.json": JSON.stringify(frozen),
          },
        });
        const compiled = goCompilationResultV1Schema.parse(
          JSON.parse(output.stdout) as unknown,
        );
        expect(
          (compiled.diagnostics ?? []).filter(
            ({ severity }) => severity === "error",
          ),
        ).toEqual([]);
        expect(output.exitCode).toBe(0);
        const text = JSON.stringify(compiled.artifact);
        expect(text).toContain("604800");
        expect(text).toContain("345600");
        expect(text).toContain(
          target === "terraform"
            ? "aws_lambda_function"
            : "AWS::Lambda::Function",
        );
      }
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
