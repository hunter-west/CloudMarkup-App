import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { aws_lambda as lambda } from "aws-cdk-lib";
import type { Construct } from "constructs";

const compilerRoot = fileURLToPath(
  new URL("../../../services/iac-compiler/", import.meta.url),
);
const executableName = "cloudmarkup-iac-import";
const toolchain = "go1.26.8";

export interface RepositoryImportParserArtifact {
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** Fixed-source, offline cross-compilation; no inherited provider credentials. */
export function buildRepositoryImportParser(): RepositoryImportParserArtifact {
  if (
    !readFileSync(join(compilerRoot, "go.mod"), "utf8")
      .replaceAll("\r\n", "\n")
      .includes(`toolchain ${toolchain}\n`)
  )
    throw new Error(
      "Review the import parser toolchain before changing its package.",
    );
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
  ])
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  Object.assign(environment, {
    CGO_ENABLED: "0",
    GOARCH: "arm64",
    GOENV: "off",
    GOFLAGS: "",
    GOOS: "linux",
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTOOLCHAIN: "local",
    GOVCS: "*:off",
    GOWORK: "off",
    GOTELEMETRY: "off",
  });
  const run = (args: string[]) =>
    execFileSync("go", args, {
      cwd: compilerRoot,
      env: environment,
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1_048_576,
      stdio: ["ignore", "pipe", "pipe"],
    });
  if (!run(["version"]).toString("utf8").startsWith(`go version ${toolchain} `))
    throw new Error(
      "The import parser requires the reviewed local Go toolchain.",
    );
  const directory = mkdtempSync(join(tmpdir(), "cloudmarkup-import-build-"));
  try {
    const executable = join(directory, executableName);
    run([
      "build",
      "-mod=readonly",
      "-trimpath",
      "-buildvcs=false",
      "-ldflags=-buildid=",
      "-o",
      executable,
      "./cmd/cloudmarkup-iac",
    ]);
    const bytes = readFileSync(executable);
    // ELF64, little endian, AArch64: never package the Windows host binary.
    if (
      bytes.length < 64 ||
      bytes.subarray(0, 6).toString("hex") !== "7f454c460201" ||
      bytes.readUInt16LE(18) !== 183
    )
      throw new Error(
        "The import parser artifact is not a Linux ARM64 executable.",
      );
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

let artifact: RepositoryImportParserArtifact | undefined;

/** CDK stages exact bytes immediately; no temporary path enters the template. */
export function createRepositoryImportParserLayer(scope: Construct): {
  readonly layer: lambda.LayerVersion;
  readonly environment: Readonly<Record<string, string>>;
} {
  artifact ??= buildRepositoryImportParser();
  const directory = mkdtempSync(join(tmpdir(), "cloudmarkup-import-layer-"));
  try {
    const executable = join(directory, executableName);
    writeFileSync(executable, artifact.bytes, { mode: 0o755 });
    chmodSync(executable, 0o755);
    const layer = new lambda.LayerVersion(scope, "RepositoryImportParser", {
      code: lambda.Code.fromAsset(directory),
      layerVersionName: "cloudmarkup-beta-repository-import-parser",
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      description:
        "Digest-pinned CloudMarkup repository inspection; offline Linux ARM64 build.",
    });
    return {
      layer,
      environment: {
        CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED: "true",
        CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH: `/opt/${executableName}`,
        CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256: artifact.sha256,
      },
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
