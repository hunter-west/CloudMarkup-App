import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APPROVED_APPLICATION_BUILD_COMMANDS,
  isApprovedApplicationBuildInvocation,
} from "./commands.js";
import type {
  ApplicationBuildCommandInvocation,
  ApplicationBuildCommandResult,
  ApplicationBuildLimitsV1,
  ApplicationBuildPolicyV1,
} from "./contracts.js";
import {
  cleanupLocalApplicationBuildResourcesForTesting,
  createLocalApplicationBuildContainerExecutor,
} from "./local-container-executor.js";

const unreachablePolicy = {} as ApplicationBuildPolicyV1;
const cleanupLimits: ApplicationBuildLimitsV1 = {
  cpuSeconds: 30,
  maxArtifactBytes: 4_096,
  maxFileBytes: 1_024,
  maxFiles: 8,
  maxOutputBytes: 4_096,
  maxProcesses: 8,
  maxTotalFileBytes: 4_096,
  memoryMiB: 512,
  wallTimeMilliseconds: 30_000,
};
const cleanupContainerName = "cloudmarkup-application-build-cleanup-fixture";
const cleanupToken = "00000000-0000-4000-8000-000000000001";
const cleanupInput = {
  cleanupToken,
  containerName: cleanupContainerName,
  limits: cleanupLimits,
  root: resolve(tmpdir(), "cloudmarkup-application-build-cleanup-fixture"),
  runtime: resolve("packages/application-build-runner/test-tools/docker.exe"),
  scannerCacheRoot: resolve(
    tmpdir(),
    "cloudmarkup-application-build-trivy-cleanup-fixture",
  ),
};

function processResult(
  input: Partial<ApplicationBuildCommandResult> = {},
): ApplicationBuildCommandResult {
  return {
    exitCode: 0,
    outputBytes: 0,
    stderr: "",
    stdout: "",
    termination: "completed",
    ...input,
  };
}

describe("local application build container boundary", () => {
  it("accepts only the exact fixed executable and argument arrays", () => {
    const approved = APPROVED_APPLICATION_BUILD_COMMANDS.install;
    expect(isApprovedApplicationBuildInvocation(approved)).toBe(true);
    expect(
      isApprovedApplicationBuildInvocation({
        ...approved,
        args: [...approved.args, "--registry=https://attacker.invalid"],
      }),
    ).toBe(false);
    expect(
      isApprovedApplicationBuildInvocation({
        ...approved,
        executable: APPROVED_APPLICATION_BUILD_COMMANDS.lint.executable,
      }),
    ).toBe(false);
    expect(
      isApprovedApplicationBuildInvocation({
        ...approved,
        executable: "/opt/cloudmarkup/bin/pnpm",
      } as unknown as ApplicationBuildCommandInvocation),
    ).toBe(false);
    expect(
      isApprovedApplicationBuildInvocation({
        ...approved,
        executable: "pnpm\n--entrypoint=/tmp/attacker",
      } as unknown as ApplicationBuildCommandInvocation),
    ).toBe(false);
  });

  it("keeps both Trivy scans offline with telemetry and version checks disabled", () => {
    for (const approved of [
      APPROVED_APPLICATION_BUILD_COMMANDS.dependencyScan,
      APPROVED_APPLICATION_BUILD_COMMANDS.secretScan,
    ]) {
      expect(approved.args).toEqual(
        expect.arrayContaining([
          "--offline-scan",
          "--skip-db-update",
          "--disable-telemetry",
          "--skip-version-check",
        ]),
      );
      expect(
        isApprovedApplicationBuildInvocation({
          ...approved,
          args: approved.args.filter(
            (argument) => argument !== "--skip-version-check",
          ),
        }),
      ).toBe(false);
      expect(
        isApprovedApplicationBuildInvocation({
          ...approved,
          args: [...approved.args, "--download-db-only"],
        }),
      ).toBe(false);
    }
  });

  it("rejects relative and non-allowlisted container binaries before use", () => {
    expect(() =>
      createLocalApplicationBuildContainerExecutor({
        containerRuntimeExecutable: "docker",
        policy: unreachablePolicy,
      }),
    ).toThrow("absolute trusted path");
    expect(() =>
      createLocalApplicationBuildContainerExecutor({
        containerRuntimeExecutable: resolve("malicious-container.exe"),
        policy: unreachablePolicy,
      }),
    ).toThrow("allow-listed Docker or Podman");
  });

  it.each([
    ["timeout", processResult({ exitCode: null, termination: "timeout" })],
    ["nonzero exit", processResult({ exitCode: 1 })],
  ])(
    "surfaces %s cleanup when the exact container remains",
    async (_label, removalResult) => {
      const invocations: string[][] = [];
      const removedDirectories: string[] = [];

      await expect(
        cleanupLocalApplicationBuildResourcesForTesting(cleanupInput, {
          removeDirectory(path) {
            removedDirectories.push(path);
            return Promise.resolve();
          },
          runProcess(_executable, args) {
            invocations.push([...args]);
            if (args[0] === "container" && args[1] === "inspect") {
              return Promise.resolve(processResult({ stdout: cleanupToken }));
            }
            return Promise.resolve(
              args[0] === "rm"
                ? removalResult
                : processResult({ stdout: cleanupContainerName }),
            );
          },
        }),
      ).rejects.toThrow("container cleanup");

      expect(invocations).toEqual([
        [
          "container",
          "ls",
          "--all",
          "--format",
          "{{.Names}}",
          "--filter",
          "name=" + cleanupContainerName,
        ],
        [
          "container",
          "inspect",
          "--format",
          '{{ index .Config.Labels "cloudmarkup.cleanup-token" }}',
          cleanupContainerName,
        ],
        ["rm", "--force", cleanupContainerName],
        [
          "container",
          "ls",
          "--all",
          "--format",
          "{{.Names}}",
          "--filter",
          "name=" + cleanupContainerName,
        ],
      ]);
      expect(removedDirectories).toEqual([]);
    },
  );

  it("treats an already absent exact container as idempotent cleanup", async () => {
    const invocations: string[][] = [];
    const removedDirectories: string[] = [];
    const seam = {
      removeDirectory(path: string) {
        removedDirectories.push(path);
        return Promise.resolve();
      },
      runProcess(
        _executable: string,
        args: readonly string[],
      ): Promise<ApplicationBuildCommandResult> {
        invocations.push([...args]);
        return Promise.resolve(processResult());
      },
    };

    await cleanupLocalApplicationBuildResourcesForTesting(cleanupInput, seam);
    await cleanupLocalApplicationBuildResourcesForTesting(cleanupInput, seam);

    expect(invocations).toHaveLength(2);
    expect(removedDirectories).toEqual([
      cleanupInput.root,
      cleanupInput.scannerCacheRoot,
      cleanupInput.root,
      cleanupInput.scannerCacheRoot,
    ]);
  });

  it("ignores prefixed and suffixed foreign container names returned by the engine filter", async () => {
    const invocations: string[][] = [];
    const removedDirectories: string[] = [];

    await expect(
      cleanupLocalApplicationBuildResourcesForTesting(cleanupInput, {
        removeDirectory(path) {
          removedDirectories.push(path);
          return Promise.resolve();
        },
        runProcess(_executable, args) {
          invocations.push([...args]);
          return Promise.resolve(
            processResult({
              stdout: `${cleanupContainerName}-foreign\r\nforeign-${cleanupContainerName}\n`,
            }),
          );
        },
      }),
    ).resolves.toBeUndefined();

    expect(invocations).toEqual([
      [
        "container",
        "ls",
        "--all",
        "--format",
        "{{.Names}}",
        "--filter",
        "name=" + cleanupContainerName,
      ],
    ]);
    expect(removedDirectories).toEqual([
      cleanupInput.root,
      cleanupInput.scannerCacheRoot,
    ]);
  });

  it.each([
    [
      "a foreign token",
      processResult({
        stdout: "00000000-0000-4000-8000-000000000002",
      }),
    ],
    [
      "an inspection timeout",
      processResult({ exitCode: null, termination: "timeout" }),
    ],
    ["an inspection failure", processResult({ exitCode: 1 })],
  ])(
    "never removes a same-name container when ownership has %s",
    async (_label, inspectionResult) => {
      const invocations: string[][] = [];
      const removedDirectories: string[] = [];

      await expect(
        cleanupLocalApplicationBuildResourcesForTesting(cleanupInput, {
          removeDirectory(path) {
            removedDirectories.push(path);
            return Promise.resolve();
          },
          runProcess(_executable, args) {
            invocations.push([...args]);
            return Promise.resolve(
              args[1] === "inspect"
                ? inspectionResult
                : processResult({ stdout: cleanupContainerName }),
            );
          },
        }),
      ).rejects.toThrow("ownership check");

      expect(
        invocations.map((args) => (args[0] ?? "") + " " + (args[1] ?? "")),
      ).toEqual(["container ls", "container inspect"]);
      expect(removedDirectories).toEqual([]);
    },
  );

  it("surfaces a failed remove even when absence is later observed", async () => {
    let listingCount = 0;

    await expect(
      cleanupLocalApplicationBuildResourcesForTesting(cleanupInput, {
        removeDirectory() {
          throw new TypeError("Host cleanup must not run.");
        },
        runProcess(_executable, args) {
          if (args[0] === "rm") {
            return Promise.resolve(processResult({ exitCode: 1 }));
          }
          if (args[1] === "inspect") {
            return Promise.resolve(processResult({ stdout: cleanupToken }));
          }
          listingCount += 1;
          return Promise.resolve(
            processResult({
              stdout: listingCount === 1 ? cleanupContainerName : "",
            }),
          );
        },
      }),
    ).rejects.toThrow("container cleanup failed");
  });
});
