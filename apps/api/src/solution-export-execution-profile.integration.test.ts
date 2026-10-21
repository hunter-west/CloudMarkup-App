import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  createGoCliSolutionExportCompilerPort,
  createSolutionExportDiagramRendererPort,
  goCompilationResultV1Schema,
} from "@cloudmarkup/solution-export-workflow";
import {
  createNativeInfrastructureWorkflowFixture,
  createNativeExportDiagramFixture,
} from "./solution-export-native-test-helpers.js";
import { createPinnedSolutionExportCompilerExecutor } from "./adapters/pinned-export-compiler.js";
import { collectProductionSolutionExportAssets } from "./production-solution-export-assets.js";
import {
  createProductionSolutionExportTargetSettings,
  loadProductionSolutionExportProfile,
} from "./production-solution-export-profile.js";
import { assertProductionSolutionExportRequest } from "./production-solution-export-host.js";
import { assertCloudFormationInfrastructureOnly } from "./solution-export-execution-profile.js";

async function removeVerifiedTemporaryRoot(
  temporaryRoot: string,
): Promise<void> {
  if (
    dirname(temporaryRoot) !== resolve(tmpdir()) ||
    !basename(temporaryRoot).startsWith("cloudmarkup-cfn-profile-")
  )
    throw new Error("Refusing unverified temporary cleanup.");
  await rm(temporaryRoot, { recursive: true, force: true });
}

const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
it
  .skipIf(executablePath === undefined || executableSha256 === undefined)
  .each(["historical", "production"] as const)(
  "compiles and renders the accepted immutable CloudFormation source with the exact %s profile and pinned Go binary",
  async (profile) => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "cloudmarkup-cfn-profile-"),
    );
    try {
      let admitted:
        | Awaited<ReturnType<typeof loadProductionSolutionExportProfile>>
        | undefined;
      if (profile === "production") {
        const assets = collectProductionSolutionExportAssets();
        const iconBundlePath = join(temporaryRoot, "diagram-icons.json");
        await writeFile(iconBundlePath, assets.iconBundle.bytes);
        await mkdir(join(temporaryRoot, "fonts"));
        for (const font of assets.runtimeFiles.filter(({ path }) =>
          path.startsWith("cloudmarkup-export/fonts/"),
        ))
          await writeFile(
            join(temporaryRoot, "fonts", basename(font.path)),
            font.bytes,
          );
        const settings = createProductionSolutionExportTargetSettings({
          compilerExecutableSha256: executableSha256 ?? "",
          iconBundleSha256: assets.iconBundle.sha256,
        });
        admitted = await loadProductionSolutionExportProfile({
          compiler: {
            executablePath: executablePath ?? "",
            executableSha256: executableSha256 ?? "",
          },
          iconBundlePath,
          iconBundleSha256: assets.iconBundle.sha256,
          targetSettingsDigest: settings.digest,
        });
      }
      const source = await createNativeInfrastructureWorkflowFixture({
        executablePath: executablePath ?? "",
        executableSha256: executableSha256 ?? "",
        temporaryRoot,
        ...(admitted === undefined
          ? {}
          : { targetSettings: admitted.targetSettings }),
      });
      if (admitted !== undefined)
        assertProductionSolutionExportRequest(
          source.request,
          admitted.targetSettings,
        );
      const input = {
        request: source.request,
        settings: source.request.targetSettings.stageDescriptors.compiler,
        signal: new AbortController().signal,
        sources: {
          architectureDocument: source.generationRequest.architectureDocument,
          solutionRevision: source.generationRequest.solutionRevision,
          workloadBehavior: source.generationRequest.workloadBehavior,
        },
      };
      assertCloudFormationInfrastructureOnly(input);
      const executor = createPinnedSolutionExportCompilerExecutor({
        executablePath: executablePath ?? "",
        executableSha256: executableSha256 ?? "",
        temporaryRoot,
      });
      const compiler = createGoCliSolutionExportCompilerPort({
        executor: {
          async execute(command) {
            const result = await executor.execute(command);
            expect(result.exitCode, result.stdout || result.stderr).toBe(0);
            return result;
          },
        },
      });
      const first = goCompilationResultV1Schema.parse(
        await compiler.compile(input),
      );
      expect(
        (first.diagnostics ?? []).filter(
          ({ severity }) => severity === "error",
        ),
      ).toEqual([]);
      expect(first).toEqual(source.compilation);
      expect(first.artifact?.target).toBe("cloudformation");
      expect(
        source.generationRequest.solutionRevision.generationCoverage,
      ).toMatchObject({
        state: "infrastructure-only",
        evidence: [],
        workloads: [{ state: "infrastructure-only", evidence: [] }],
      });
      expect(JSON.stringify(first.artifact)).toContain("AWS::Lambda::Function");
      const diagram = createSolutionExportDiagramRendererPort(
        admitted?.diagram ?? (await createNativeExportDiagramFixture()),
      );
      await diagram.render({
        request: source.request,
        settings:
          source.request.targetSettings.stageDescriptors.diagramRenderer,
        signal: new AbortController().signal,
        sources: input.sources,
      });
      expect(await compiler.compile(input)).toEqual(first);
      expect(await readdir(temporaryRoot)).toEqual(
        profile === "production" ? ["diagram-icons.json", "fonts"] : [],
      );
    } finally {
      await removeVerifiedTemporaryRoot(temporaryRoot);
    }
  },
  60_000,
);
