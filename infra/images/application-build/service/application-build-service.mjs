#!/usr/bin/env node
import { readFile, mkdir, rm, writeFile, lstat } from "node:fs/promises";

import {
  materializeArchive,
  readTarArchive,
  verifyArchiveManifest,
} from "./archive.mjs";
import {
  canonicalJson,
  EXACT_RUNTIME,
  sanitizeToolText,
  sha256,
  validateApplicationPackage,
  validateRequest,
} from "./contract.mjs";
import { buildResult, executeFixedSequence } from "./executor.mjs";

export const PATHS = Object.freeze({
  archive: "/workspace/input/application.tar",
  input: "/workspace/input/application-build-request-v1.json",
  output: "/workspace/output/application-build-result-v1.json",
  outputRoot: "/workspace/output",
  workspace: "/workspace/work",
});

function errorResult(state, error, request) {
  const projection = {
    contractVersion: 1,
    diagnostics: [
      {
        code: `cloudmarkup.application-build.${state}`,
        detail: sanitizeToolText(
          error instanceof Error ? error.message : String(error),
        ),
        source: "admission",
        summary:
          state === "blocked"
            ? "The application build input was rejected."
            : "The application build service failed closed.",
      },
    ],
    kind: "cloudmarkup.application-build-executor-result",
    ...(request?.profileId === undefined
      ? {}
      : { profileId: request.profileId }),
    ...(request?.requestDigest === undefined
      ? {}
      : { requestDigest: request.requestDigest }),
    ...(request?.solutionRevisionDigest === undefined
      ? {}
      : { solutionRevisionDigest: request.solutionRevisionDigest }),
    state,
    steps: [],
    ...(request?.workloadId === undefined
      ? {}
      : { workloadId: request.workloadId }),
  };
  return { ...projection, reportDigest: sha256(canonicalJson(projection)) };
}

async function regularFile(path, maximum) {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maximum) {
    throw new TypeError("Service input must be a bounded regular file.");
  }
  return stats;
}

export async function runApplicationBuildService({
  paths = PATHS,
  runCommand,
  runtimeVersion = process.versions.node,
  signal,
} = {}) {
  let request;
  let outcome;
  try {
    await regularFile(paths.input, 4 * 1024 * 1024);
    const inputText = await readFile(paths.input, "utf8");
    if (Buffer.byteLength(inputText, "utf8") > 4 * 1024 * 1024) {
      throw new RangeError("Application build request exceeds 4 MiB.");
    }
    request = validateRequest(JSON.parse(inputText));
    if (runtimeVersion !== EXACT_RUNTIME.node) {
      throw new TypeError(
        "Application build service is running an unsupported Node.js version.",
      );
    }
    const archiveStats = await regularFile(
      paths.archive,
      request.sourceArchive.sizeBytes,
    );
    if (archiveStats.size !== request.sourceArchive.sizeBytes) {
      throw new TypeError("Source archive size does not match the request.");
    }
    const archiveBytes = await readFile(paths.archive);
    if (sha256(archiveBytes) !== request.sourceArchive.sha256) {
      throw new TypeError("Source archive digest does not match the request.");
    }
    const files = readTarArchive(archiveBytes, request.limits);
    verifyArchiveManifest(files, request.sourceFiles);
    await rm(paths.workspace, { force: true, recursive: true });
    const filesByPath = await materializeArchive(files, paths.workspace);
    validateApplicationPackage(filesByPath, request);
    const execution = await executeFixedSequence({
      request,
      ...(runCommand === undefined ? {} : { runCommand }),
      signal,
      workspaceRoot: paths.workspace,
    });
    outcome = {
      exitCode: execution.state === "passed" ? 0 : 2,
      result: buildResult(request, execution),
    };
  } catch (error) {
    const blocked =
      error instanceof SyntaxError ||
      error instanceof TypeError ||
      error instanceof RangeError;
    outcome = {
      exitCode: blocked ? 2 : 70,
      result: errorResult(blocked ? "blocked" : "error", error, request),
    };
  }
  try {
    await rm(paths.workspace, { force: true, recursive: true });
  } catch (error) {
    return {
      exitCode: 70,
      result: errorResult("error", error, request),
    };
  }
  return outcome;
}

async function main() {
  if (process.argv.length !== 2) {
    const result = errorResult(
      "blocked",
      new TypeError("The service accepts no command-line arguments."),
    );
    await mkdir(PATHS.outputRoot, { recursive: true, mode: 0o700 });
    await writeFile(PATHS.output, canonicalJson(result), {
      flag: "wx",
      mode: 0o600,
    });
    process.exitCode = 2;
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const outcome = await runApplicationBuildService({
    signal: controller.signal,
  });
  await mkdir(PATHS.outputRoot, { recursive: true, mode: 0o700 });
  await writeFile(PATHS.output, canonicalJson(outcome.result), {
    flag: "wx",
    mode: 0o600,
  });
  process.exitCode = outcome.exitCode;
}

const invoked = process.argv[1]
  ?.replaceAll("\\", "/")
  .endsWith("/application-build-service.mjs");
if (invoked) await main();
