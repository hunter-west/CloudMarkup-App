import {
  link,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { generateApplication } from "@cloudmarkup/application-generator";
import { createEventGenerationRequest } from "@cloudmarkup/application-generator/testing";
import { describe, expect, it } from "vitest";

import { APPROVED_APPLICATION_BUILD_COMMANDS } from "./commands.js";
import {
  applicationBuildPolicyV1Schema,
  applicationBuildProfileV1Schema,
  applicationBuildRequestV1Schema,
  applicationDependencyLockV1Schema,
  type ApplicationBuildCommandResult,
  type ApplicationBuildPolicyV1,
} from "./contracts.js";
import { createLocalApplicationBuildContainerExecutorForTesting } from "./local-container-executor.js";
import { createApplicationBuildRunner } from "./runner.js";
import { canonicalJson, sha256Digest } from "./security.js";

const assessedAt = "2026-08-27T12:00:00.000Z";
const fakeContainerRuntime = resolve(
  "packages/application-build-runner/test-tools/docker.exe",
);
const containerExecutableByCommandName = {
  eslint: "/opt/cloudmarkup/bin/eslint",
  pnpm: "/opt/cloudmarkup/bin/pnpm",
  trivy: "/opt/cloudmarkup/bin/trivy",
  tsc: "/opt/cloudmarkup/bin/tsc",
  vitest: "/opt/cloudmarkup/bin/vitest",
} as const;

function pin(id: string, version: string) {
  return { digest: sha256Digest(`${id}@${version}`), id, version };
}

function generatedProfile() {
  const descriptor = {
    id: "cloudmarkup.application-build.generated-nodejs24" as const,
    sourcePolicy: "generated-only" as const,
    version: "1.0.0" as const,
  };
  return applicationBuildProfileV1Schema.parse({
    ...descriptor,
    digest: sha256Digest(canonicalJson(descriptor)),
  });
}

function policy(): ApplicationBuildPolicyV1 {
  return applicationBuildPolicyV1Schema.parse({
    builder: pin("cloudmarkup.application-builder", "1.0.0"),
    container: {
      digest: sha256Digest("cloudmarkup-application-build-image-v1"),
      image: "cloudmarkup/application-build",
      platform: "linux/amd64",
      pnpmStorePath: "/opt/cloudmarkup/pnpm-store",
    },
    contractVersion: 1,
    dependencyCacheDigest: sha256Digest("approved-offline-pnpm-store-v1"),
    defaultLimits: {
      cpuSeconds: 120,
      maxArtifactBytes: 16 * 1024 * 1024,
      maxFileBytes: 2 * 1024 * 1024,
      maxFiles: 2_048,
      maxOutputBytes: 256 * 1024,
      maxProcesses: 32,
      maxTotalFileBytes: 64 * 1024 * 1024,
      memoryMiB: 1_024,
      wallTimeMilliseconds: 120_000,
    },
    dependencyAllowlist: [
      {
        kind: "runtime",
        name: "@aws-sdk/client-dynamodb",
        version: "3.1101.0",
      },
      { kind: "development", name: "@types/node", version: "24.13.3" },
      { kind: "development", name: "typescript", version: "6.0.3" },
      { kind: "development", name: "vitest", version: "4.1.10" },
    ],
    dependencyDenylist: ["event-stream", "ua-parser-js"],
    profile: generatedProfile(),
    scanner: pin("aquasecurity.trivy", "0.74.0"),
    secretScanner: pin("aquasecurity.trivy-secret", "0.74.0"),
    toolchain: [
      pin("runtime.nodejs", "24.18.0"),
      pin("package-manager.pnpm", "11.16.0"),
      pin("compiler.typescript", "6.0.3"),
      pin("test-runner.vitest", "4.1.10"),
      pin("packager.cloudmarkup-lambda-zip", "1.0.0"),
    ],
  });
}

function fixture() {
  const generationRequest = createEventGenerationRequest({
    pattern: "sqs-consumer-dlq",
  });
  const applicationGeneration = generateApplication(generationRequest);
  const envelope = applicationGeneration.artifact.buildContracts[0];
  const packageFile = applicationGeneration.artifact.sourceFiles.find(
    (file) => file.path === "application/package.json",
  );
  if (envelope === undefined || packageFile === undefined) {
    throw new TypeError("Missing generated local-executor fixture input.");
  }
  const lockfileContent = `lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\n`;
  const buildPolicy = policy();
  const packageManager = buildPolicy.toolchain.find(
    (tool) => tool.id === "package-manager.pnpm",
  );
  if (packageManager === undefined) throw new TypeError("Missing pnpm pin.");
  const dependencyLock = applicationDependencyLockV1Schema.parse({
    cache: {
      digest: buildPolicy.dependencyCacheDigest,
      kind: "prepackaged-content-addressed",
      network: "deny",
    },
    contractVersion: 1,
    lifecycleScripts: "deny",
    lockfileChecksum: sha256Digest(lockfileContent),
    lockfileContent,
    lockfilePath: "application/pnpm-lock.yaml",
    packageManager,
    packageManifestChecksum: packageFile.checksum,
    packages: (
      [
        ["@aws-sdk/client-dynamodb", "3.1101.0", "runtime"],
        ["@smithy/types", "4.9.0", "transitive-runtime"],
        ["@types/node", "24.13.3", "development"],
        ["typescript", "6.0.3", "development"],
        ["vitest", "4.1.10", "development"],
      ] as const
    ).map(([name, version, kind]) => ({
      integrity: `sha512-${"A".repeat(86)}==`,
      kind,
      name,
      tarballDigest: sha256Digest(`${name}@${version}:tarball`),
      version,
    })),
  });
  const request = applicationBuildRequestV1Schema.parse({
    assessedAt,
    contractVersion: 1,
    dependencyLock,
    environment: {
      environmentId: "environment.development",
      environmentType: "development",
    },
    limits: buildPolicy.defaultLimits,
    profile: buildPolicy.profile,
    solutionRevision: generationRequest.solutionRevision,
    solutionRevisionDigest: sha256Digest(
      canonicalJson(generationRequest.solutionRevision),
    ),
    source: {
      applicationGeneration,
      buildContractDigest: envelope.contractDigest,
      kind: "generated",
    },
  });
  return { applicationGeneration, buildPolicy, envelope, request };
}

async function writeRegular(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const target = resolve(root, path.split("/").join(sep));
  if (!target.startsWith(`${root}${sep}`)) {
    throw new TypeError("Test stub path escaped its workspace.");
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
}

async function writePackage(
  root: string,
  name: string,
  version: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const packageRoot = `application/node_modules/${name}`;
  await writeRegular(
    root,
    `${packageRoot}/package.json`,
    `${JSON.stringify({ name, type: "module", version })}\n`,
  );
  for (const [path, content] of Object.entries(files)) {
    await writeRegular(root, `${packageRoot}/${path}`, content);
  }
}

type StubMode =
  | "oversized-known"
  | "oversized-unknown"
  | "regular"
  | "pnpm-metadata"
  | "source-mutation"
  | "runtime-mutation"
  | "unexpected-source"
  | "hard-link"
  | "compiled-mutation"
  | "escaping"
  | "dangling"
  | "cyclic"
  | "residual-dev"
  | "residual-virtual-store"
  | "residual-bin";

async function writeInstalledTree(root: string, mode: StubMode): Promise<void> {
  if (mode === "oversized-known" || mode === "oversized-unknown") {
    const directory = mode === "oversized-known" ? "typescript/lib" : "runtime";
    await writeRegular(
      root,
      "application/node_modules/" + directory + "/typescript.js",
      "x".repeat(9144216),
    );
  }
  await writePackage(root, "@aws-sdk/client-dynamodb", "3.1101.0", {
    ".hidden/review.txt": "excluded hidden fixture\n",
    "index.d.ts": "export declare const client: unknown;\n",
    "index.js": "export const client = {};\n",
    "index.js.map": "excluded source map\n",
    "tests/client.test.js": "excluded test\n",
  });
  await writePackage(root, "@smithy/types", "4.9.0", {
    "index.js": "export const smithyType = 'runtime';\n",
  });
  await writePackage(root, "@types/node", "24.13.3", {
    "index.d.ts": "export {};\n",
  });
  await writePackage(root, "typescript", "6.0.3", {
    "index.js": "export {};\n",
  });
  await writePackage(root, "vitest", "4.1.10", {
    "index.js": "export {};\n",
  });
  await writeRegular(
    root,
    "application/node_modules/.pnpm/store-metadata.json",
    "{}\n",
  );
  if (mode === "residual-bin") {
    await writeRegular(
      root,
      "application/node_modules/.bin/runtime-tool",
      "forbidden bin shim\n",
    );
  }
  if (!new Set(["escaping", "dangling", "cyclic"]).has(mode)) return;
  const nodeModules = resolve(root, "application/node_modules");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  if (mode === "escaping") {
    const target = resolve(root, "application/escape-target");
    await mkdir(target, { recursive: true });
    await symlink(target, resolve(nodeModules, "escape-link"), linkType);
  } else if (mode === "dangling") {
    await symlink(
      resolve(root, "application/missing-target"),
      resolve(nodeModules, "dangling-link"),
      linkType,
    );
  } else {
    const first = resolve(nodeModules, "cycle-a");
    const second = resolve(nodeModules, "cycle-b");
    await symlink(second, first, linkType);
    await symlink(first, second, linkType);
  }
}

async function writeCompiledTree(
  root: string,
  buildFixture: ReturnType<typeof fixture>,
): Promise<void> {
  const sourceRoot = buildFixture.envelope.contract.entrypoint.slice(
    0,
    buildFixture.envelope.contract.entrypoint.lastIndexOf("/") + 1,
  );
  const compiledRoot = buildFixture.envelope.contract.compiledEntrypoint.slice(
    0,
    buildFixture.envelope.contract.compiledEntrypoint.lastIndexOf("/") + 1,
  );
  for (const file of buildFixture.applicationGeneration.artifact.sourceFiles) {
    if (!file.path.startsWith(sourceRoot) || !file.path.endsWith(".ts")) {
      continue;
    }
    await writeRegular(
      root,
      `${compiledRoot}${file.path
        .slice(sourceRoot.length)
        .replace(/\.ts$/u, ".js")}`,
      `export const compiled = ${JSON.stringify(file.path)};\n`,
    );
  }
}

interface StubRun {
  readonly dockerArgs: readonly string[];
  readonly step: string;
}

function completed(stdout = ""): ApplicationBuildCommandResult {
  return {
    exitCode: 0,
    outputBytes: Buffer.byteLength(stdout),
    stderr: "",
    stdout,
    termination: "completed",
  };
}

function workspaceFromDockerArgs(args: readonly string[]): string {
  const mountIndex = args.indexOf("--mount");
  const mount = args[mountIndex + 1];
  const match =
    /^type=bind,source=(.+),target=\/workspace(?:,readonly)?$/u.exec(
      mount ?? "",
    );
  if (match?.[1] === undefined) {
    throw new TypeError("Missing exact workspace mount in Docker stub.");
  }
  return match[1];
}

function stubProcessRunner(
  buildFixture: ReturnType<typeof fixture>,
  mode: StubMode,
  runs: StubRun[],
) {
  return async (
    executable: string,
    args: readonly string[],
  ): Promise<ApplicationBuildCommandResult> => {
    if (executable !== fakeContainerRuntime) {
      throw new TypeError("Unexpected container executable.");
    }
    if (args[0] === "rm") return completed();
    if (args[0] === "container") return completed();
    const image = `${buildFixture.buildPolicy.container.image}@${buildFixture.buildPolicy.container.digest}`;
    const imageIndex = args.indexOf(image);
    const commandExecutable = args[imageIndex - 1];
    const commandArgs = args.slice(imageIndex + 1);
    const command = Object.values(APPROVED_APPLICATION_BUILD_COMMANDS).find(
      (candidate) =>
        containerExecutableByCommandName[candidate.executable] ===
          commandExecutable &&
        candidate.args.length === commandArgs.length &&
        candidate.args.every((value, index) => value === commandArgs[index]),
    );
    if (args[imageIndex - 2] !== "--entrypoint" || command === undefined) {
      throw new TypeError("Docker stub received a non-approved command.");
    }
    runs.push({ dockerArgs: [...args], step: command.step });
    const root = workspaceFromDockerArgs(args);
    if (command.step === "install") await writeInstalledTree(root, mode);
    if (command.step === "compile") {
      await writeCompiledTree(root, buildFixture);
    }
    if (command.step === "unit-tests") {
      const sourcePath =
        buildFixture.applicationGeneration.artifact.sourceFiles.find(
          (file) =>
            file.path.startsWith("application/src/") &&
            file.path.endsWith(".ts"),
        )?.path;
      if (sourcePath === undefined) {
        throw new TypeError("Missing source mutation fixture path.");
      }
      if (mode === "source-mutation") {
        const target = resolve(root, sourcePath.split("/").join(sep));
        const bytes = await readFile(target);
        bytes[0] = (bytes[0] ?? 0) ^ 1;
        await writeFile(target, bytes);
      }
      if (mode === "unexpected-source") {
        await writeRegular(
          root,
          "application/src/unreviewed.ts",
          "export const unreviewed = true;\n",
        );
      }
      if (mode === "hard-link") {
        await link(
          resolve(root, sourcePath.split("/").join(sep)),
          resolve(root, "application/src/unreviewed-hard-link.ts"),
        );
      }
    }
    if (command.step === "contract-tests" && mode === "runtime-mutation") {
      await writeRegular(
        root,
        "application/node_modules/@aws-sdk/client-dynamodb/index.js",
        "export const client = { unreviewed: true };\n",
      );
    }
    if (command.step === "production-prune") {
      await expect(
        lstat(resolve(root, "application/node_modules")),
      ).rejects.toThrow();
      await writeInstalledTree(root, mode);
      const removed = [
        ...(mode === "residual-virtual-store" ? [] : [".pnpm"]),
        "@types",
        "typescript",
        ...(mode === "residual-dev" ? [] : ["vitest"]),
      ];
      for (const path of removed) {
        await rm(resolve(root, "application/node_modules", path), {
          force: true,
          recursive: true,
        });
      }
      if (mode === "pnpm-metadata") {
        await writeRegular(
          root,
          "application/node_modules/.pnpm/lock.yaml",
          "lockfileVersion: '9.0'\n",
        );
        await writeRegular(
          root,
          "application/node_modules/.package-map.json",
          "{}\n",
        );
        await writeRegular(
          root,
          "application/node_modules/.pnpm-workspace-state-v1.json",
          "{}\n",
        );
      }
      if (mode === "compiled-mutation") {
        await writeRegular(
          root,
          buildFixture.envelope.contract.compiledEntrypoint,
          "export const compiled = 'unreviewed';\n",
        );
      }
    }
    if (command.step === "unit-tests" || command.step === "contract-tests") {
      return completed(
        JSON.stringify({
          numFailedTests: 0,
          numPassedTests: 2,
          numPendingTests: 0,
        }),
      );
    }
    if (command.step === "dependency-scan" || command.step === "secret-scan") {
      return completed('{"Results":[]}');
    }
    return completed();
  };
}

async function runWithLocalAdapter(mode: StubMode) {
  const buildFixture = fixture();
  const runs: StubRun[] = [];
  const executor = createLocalApplicationBuildContainerExecutorForTesting(
    {
      containerRuntimeExecutable: fakeContainerRuntime,
      policy: buildFixture.buildPolicy,
    },
    {
      containerUser: "65532:65532",
      runProcess: stubProcessRunner(buildFixture, mode, runs),
    },
  );
  const result = await createApplicationBuildRunner({
    executor,
    policy: buildFixture.buildPolicy,
  }).run(buildFixture.request);
  return { buildFixture, result, runs };
}

describe("local application build adapter integration", () => {
  it("packages an exact regular production closure deterministically", async () => {
    const first = await runWithLocalAdapter("regular");
    const second = await runWithLocalAdapter("regular");
    expect(first.result.state, JSON.stringify(first.result.diagnostics)).toBe(
      "passed",
    );
    expect(first.runs.map(({ step }) => step)).toEqual([
      "install",
      "lint",
      "typecheck",
      "unit-tests",
      "contract-tests",
      "dependency-scan",
      "secret-scan",
      "compile",
      "production-prune",
    ]);
    for (const { dockerArgs, step } of first.runs) {
      const command = Object.values(APPROVED_APPLICATION_BUILD_COMMANDS).find(
        (candidate) => candidate.step === step,
      );
      expect(command).toBeDefined();
      const image = `${first.buildFixture.buildPolicy.container.image}@${first.buildFixture.buildPolicy.container.digest}`;
      const imageIndex = dockerArgs.indexOf(image);
      expect(dockerArgs[imageIndex - 2]).toBe("--entrypoint");
      expect(dockerArgs[imageIndex - 1]).toBe(
        command === undefined
          ? undefined
          : containerExecutableByCommandName[command.executable],
      );
      expect(dockerArgs.slice(imageIndex + 1)).toEqual(command?.args);
      expect(dockerArgs.slice(imageIndex + 1)).not.toContain(
        command?.executable,
      );
      expect(dockerArgs).toContain("none");
      expect(dockerArgs[dockerArgs.indexOf("--user") + 1]).toBe("65532:65532");
      const workspaceMount = dockerArgs[dockerArgs.indexOf("--mount") + 1];
      if (new Set(["install", "compile", "production-prune"]).has(step)) {
        expect(workspaceMount).not.toMatch(/,readonly$/u);
      } else {
        expect(workspaceMount).toMatch(/,readonly$/u);
      }
      const mounts = dockerArgs.flatMap((argument, index) =>
        argument === "--mount" ? [dockerArgs[index + 1] ?? ""] : [],
      );
      const scannerMounts = mounts.filter((mount) =>
        mount.endsWith(",target=/tmp/cloudmarkup-trivy-cache"),
      );
      if (new Set(["dependency-scan", "secret-scan"]).has(step)) {
        expect(scannerMounts).toHaveLength(1);
        expect(scannerMounts[0]).toMatch(
          /^type=bind,source=.+cloudmarkup-application-build-trivy-[^,]+,target=\/tmp\/cloudmarkup-trivy-cache$/u,
        );
      } else {
        expect(scannerMounts).toEqual([]);
      }
    }
    const firstZip = first.result.artifacts.find(
      (artifact) => artifact.mediaType === "application/zip",
    );
    const secondZip = second.result.artifacts.find(
      (artifact) => artifact.mediaType === "application/zip",
    );
    expect(secondZip).toEqual(firstZip);
    const archive = Buffer.from(firstZip?.bytesBase64 ?? "", "base64").toString(
      "utf8",
    );
    expect(archive).toContain(
      "node_modules/@aws-sdk/client-dynamodb/package.json",
    );
    expect(archive).toContain("node_modules/@smithy/types/index.js");
    expect(archive).not.toContain("node_modules/vitest");
    expect(archive).not.toContain("node_modules/typescript");
    expect(archive).not.toContain("node_modules/@types");
    expect(archive).not.toContain("node_modules/.pnpm");
    expect(archive).not.toContain("index.d.ts");
    expect(archive).not.toContain("index.js.map");
    expect(archive).not.toContain("tests/client.test.js");
  });

  it("excludes the closed regular pnpm production metadata from artifacts", async () => {
    const { result } = await runWithLocalAdapter("pnpm-metadata");
    expect(result.state).toBe("passed");
    for (const artifact of result.artifacts) {
      const bytes = Buffer.from(artifact.bytesBase64, "base64");
      expect(bytes.toString("utf8")).not.toContain("node_modules/.pnpm");
      expect(bytes.toString("utf8")).not.toContain(
        "node_modules/.package-map.json",
      );
    }
  });

  it.each(["escaping", "dangling", "cyclic"] as const)(
    "fails closed on %s dependency links",
    async (mode) => {
      const { result } = await runWithLocalAdapter(mode);
      expect(result.state).toBe("error");
      expect(result.artifacts).toEqual([]);
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "application.build.runner-error",
      );
    },
  );

  it.each(["residual-dev", "residual-virtual-store", "residual-bin"] as const)(
    "fails closed when production prune retains %s",
    async (mode) => {
      const { result } = await runWithLocalAdapter(mode);
      expect(result.state).toBe("error");
      expect(result.artifacts).toEqual([]);
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "application.build.runner-error",
      );
    },
  );

  it.each([
    "oversized-known",
    "oversized-unknown",
    "source-mutation",
    "runtime-mutation",
    "unexpected-source",
    "hard-link",
    "compiled-mutation",
  ] as const)("fails closed on %s authority mutation", async (mode) => {
    const { result } = await runWithLocalAdapter(mode);
    expect(result.state).toBe("error");
    expect(result.artifacts).toEqual([]);
    expect(result.evidence.artifacts).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "application.build.runner-error",
    );
  });
});
