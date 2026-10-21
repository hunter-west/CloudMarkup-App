import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  TerraformValidationLimitsV1,
  ValidationCommandResult,
} from "./contracts.js";
import {
  assertExactVolumeAbsentForTesting,
  cleanupFailedValidationOpenForTesting,
} from "./local-container-executor.js";

const limits: TerraformValidationLimitsV1 = {
  cpuSeconds: 30,
  maxFileBytes: 1_024,
  maxFiles: 8,
  maxOutputBytes: 4_096,
  maxProcesses: 8,
  maxTotalFileBytes: 4_096,
  memoryMiB: 512,
  wallTimeMilliseconds: 30_000,
};
const volumeName = "cloudmarkup-terraform-validation-cleanup-fixture";
const stageContainerName = volumeName + "-stage";
const cleanupToken = "00000000-0000-4000-8000-000000000001";
const cleanupInput = {
  cleanupToken,
  limits,
  root: resolve(tmpdir(), "cloudmarkup-terraform-validation-cleanup-fixture"),
  runtime: resolve(
    "packages/terraform-validation-runner/test-tools/docker.exe",
  ),
  volumeCleanupRequired: true,
  volumeName,
};

function processResult(
  input: Partial<ValidationCommandResult> = {},
): ValidationCommandResult {
  return {
    exitCode: 0,
    outputBytes: 0,
    stderr: "",
    stdout: "",
    termination: "completed",
    ...input,
  };
}

function isContainerRemoval(args: readonly string[]): boolean {
  return args[0] === "rm";
}

function isContainerListing(args: readonly string[]): boolean {
  return args[0] === "container" && args[1] === "ls";
}

function isContainerInspection(args: readonly string[]): boolean {
  return args[0] === "container" && args[1] === "inspect";
}

function isVolumeRemoval(args: readonly string[]): boolean {
  return args[0] === "volume" && args[1] === "rm";
}

function isVolumeListing(args: readonly string[]): boolean {
  return args[0] === "volume" && args[1] === "ls";
}

function isVolumeInspection(args: readonly string[]): boolean {
  return args[0] === "volume" && args[1] === "inspect";
}

const containerListingArgs = [
  "container",
  "ls",
  "--all",
  "--format",
  "{{.Names}}",
  "--filter",
  "name=" + stageContainerName,
];
const containerInspectionArgs = [
  "container",
  "inspect",
  "--format",
  '{{ index .Config.Labels "cloudmarkup.cleanup-token" }}',
  stageContainerName,
];
const volumeListingArgs = [
  "volume",
  "ls",
  "--format",
  "{{.Name}}",
  "--filter",
  "name=" + volumeName,
];
const volumeInspectionArgs = [
  "volume",
  "inspect",
  "--format",
  '{{ index .Labels "cloudmarkup.cleanup-token" }}',
  volumeName,
];

describe("failed Terraform workspace cleanup", () => {
  it.each([
    [
      "container timeout",
      "container",
      processResult({ exitCode: null, termination: "timeout" }),
    ],
    ["container nonzero exit", "container", processResult({ exitCode: 1 })],
    [
      "volume timeout",
      "volume",
      processResult({ exitCode: null, termination: "timeout" }),
    ],
    ["volume nonzero exit", "volume", processResult({ exitCode: 1 })],
  ] as const)(
    "surfaces %s and preserves the host bind source",
    async (_label, failedResource, removalFailure) => {
      const invocations: string[][] = [];
      const removedDirectories: string[] = [];

      await expect(
        cleanupFailedValidationOpenForTesting(cleanupInput, {
          removeDirectory(path) {
            removedDirectories.push(path);
            return Promise.resolve();
          },
          runProcess(_executable, args) {
            invocations.push([...args]);
            if (isContainerListing(args)) {
              return Promise.resolve(
                processResult({
                  stdout:
                    failedResource === "container" ? stageContainerName : "",
                }),
              );
            }
            if (isContainerInspection(args)) {
              return Promise.resolve(processResult({ stdout: cleanupToken }));
            }
            if (isContainerRemoval(args)) {
              return Promise.resolve(
                failedResource === "container"
                  ? removalFailure
                  : processResult(),
              );
            }
            if (isVolumeListing(args)) {
              return Promise.resolve(
                processResult({
                  stdout: failedResource === "volume" ? volumeName : "",
                }),
              );
            }
            if (isVolumeInspection(args)) {
              return Promise.resolve(processResult({ stdout: cleanupToken }));
            }
            if (isVolumeRemoval(args)) {
              return Promise.resolve(
                failedResource === "volume" ? removalFailure : processResult(),
              );
            }
            throw new TypeError("Unexpected cleanup invocation.");
          },
        }),
      ).rejects.toThrow("engine cleanup");

      expect(invocations).toEqual(
        failedResource === "container"
          ? [
              containerListingArgs,
              containerInspectionArgs,
              ["rm", "--force", stageContainerName],
              containerListingArgs,
              volumeListingArgs,
            ]
          : [
              containerListingArgs,
              volumeListingArgs,
              volumeInspectionArgs,
              ["volume", "rm", "--force", volumeName],
              volumeListingArgs,
            ],
      );
      expect(removedDirectories).toEqual([]);
    },
  );

  it("treats already absent exact engine resources as idempotent cleanup", async () => {
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
      ): Promise<ValidationCommandResult> {
        invocations.push([...args]);
        return Promise.resolve(processResult());
      },
    };

    await cleanupFailedValidationOpenForTesting(cleanupInput, seam);
    await cleanupFailedValidationOpenForTesting(cleanupInput, seam);

    expect(invocations).toEqual([
      containerListingArgs,
      volumeListingArgs,
      containerListingArgs,
      volumeListingArgs,
    ]);
    expect(removedDirectories).toEqual([cleanupInput.root, cleanupInput.root]);
  });

  it("surfaces a failed volume remove even when absence is later observed", async () => {
    let volumeListingCount = 0;

    await expect(
      cleanupFailedValidationOpenForTesting(cleanupInput, {
        removeDirectory() {
          throw new TypeError("Host cleanup must not run.");
        },
        runProcess(_executable, args) {
          if (isContainerListing(args)) return Promise.resolve(processResult());
          if (isVolumeInspection(args)) {
            return Promise.resolve(processResult({ stdout: cleanupToken }));
          }
          if (isVolumeRemoval(args)) {
            return Promise.resolve(processResult({ exitCode: 1 }));
          }
          if (isVolumeListing(args)) {
            volumeListingCount += 1;
            return Promise.resolve(
              processResult({
                stdout: volumeListingCount === 1 ? volumeName : "",
              }),
            );
          }
          throw new TypeError("Unexpected cleanup invocation.");
        },
      }),
    ).rejects.toThrow("engine cleanup");
  });

  it.each([
    ["a foreign token", processResult({ stdout: "foreign-token" })],
    [
      "an inspection timeout",
      processResult({ exitCode: null, termination: "timeout" }),
    ],
    ["an inspection failure", processResult({ exitCode: 1 })],
  ])(
    "never removes a same-name volume when ownership has %s",
    async (_label, inspectionResult) => {
      const invocations: string[][] = [];
      const removedDirectories: string[] = [];

      await expect(
        cleanupFailedValidationOpenForTesting(cleanupInput, {
          removeDirectory(path) {
            removedDirectories.push(path);
            return Promise.resolve();
          },
          runProcess(_executable, args) {
            invocations.push([...args]);
            if (isContainerListing(args))
              return Promise.resolve(processResult());
            if (isVolumeListing(args)) {
              return Promise.resolve(processResult({ stdout: volumeName }));
            }
            if (isVolumeInspection(args)) {
              return Promise.resolve(inspectionResult);
            }
            throw new TypeError("Cleanup must not remove an unowned volume.");
          },
        }),
      ).rejects.toThrow("engine cleanup");

      expect(invocations).toEqual([
        containerListingArgs,
        volumeListingArgs,
        volumeInspectionArgs,
      ]);
      expect(removedDirectories).toEqual([]);
    },
  );
});

describe("Terraform validation volume collision probe", () => {
  it.each([
    ["timeout", processResult({ exitCode: null, termination: "timeout" })],
    ["nonzero exit", processResult({ exitCode: 1 })],
  ])("fails closed on a %s", async (_label, lookupResult) => {
    const invocations: string[][] = [];

    await expect(
      assertExactVolumeAbsentForTesting(
        {
          limits,
          runtime: cleanupInput.runtime,
          volumeName,
        },
        (_executable, args) => {
          invocations.push([...args]);
          return Promise.resolve(lookupResult);
        },
      ),
    ).rejects.toThrow("collision lookup failed");

    expect(invocations).toEqual([volumeListingArgs]);
  });

  it("rejects an exact pre-existing volume but ignores partial-name matches", async () => {
    await expect(
      assertExactVolumeAbsentForTesting(
        {
          limits,
          runtime: cleanupInput.runtime,
          volumeName,
        },
        () => Promise.resolve(processResult({ stdout: volumeName })),
      ),
    ).rejects.toThrow("already exists");

    await expect(
      assertExactVolumeAbsentForTesting(
        {
          limits,
          runtime: cleanupInput.runtime,
          volumeName,
        },
        () => Promise.resolve(processResult({ stdout: volumeName + "-other" })),
      ),
    ).resolves.toBeUndefined();
  });
});
