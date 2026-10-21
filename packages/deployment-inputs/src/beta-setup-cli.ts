#!/usr/bin/env node

import { lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BETA_SETUP_DISCOVERY_SCHEMA_VERSION,
  mergeBetaSetupDiscoveryV1,
  validateBetaSetupDiscoveryV1,
} from "./beta-setup.js";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;

class CliInputError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type OutputWriter = (value: unknown) => void;

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readBoundedJson(path: string, label: string): Promise<unknown> {
  const inputPath = resolve(path);
  let metadata;
  try {
    metadata = await lstat(inputPath);
  } catch {
    throw new CliInputError(
      "beta-setup-input.file-unavailable",
      `${label} input is unavailable.`,
    );
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new CliInputError(
      "beta-setup-input.file-invalid",
      `${label} input must be one regular, non-link JSON file.`,
    );
  }
  if (metadata.size < 2 || metadata.size > MAX_INPUT_BYTES) {
    throw new CliInputError(
      "beta-setup-input.file-size-invalid",
      `${label} input is outside the bounded file-size policy.`,
    );
  }
  const serialized = await readFile(inputPath, "utf8");
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new CliInputError(
      "beta-setup-input.json-invalid",
      `${label} input must be valid UTF-8 JSON.`,
    );
  }
}

async function validateCommand(
  arguments_: readonly string[],
  emit: OutputWriter,
): Promise<number> {
  if (arguments_.length !== 1) {
    throw new CliInputError(
      "beta-setup-input.usage-invalid",
      "Use: validate <setup-discovery.json>.",
    );
  }
  const discovery = await readBoundedJson(arguments_[0] ?? "", "Discovery");
  const result = validateBetaSetupDiscoveryV1(discovery);
  if (!result.valid) {
    emit({ issues: result.issues, valid: false });
    return 1;
  }
  emit({
    digest: result.digest,
    schemaVersion: BETA_SETUP_DISCOVERY_SCHEMA_VERSION,
    valid: true,
  });
  return 0;
}

async function mergeCommand(
  arguments_: readonly string[],
  emit: OutputWriter,
): Promise<number> {
  if (arguments_.length !== 3) {
    throw new CliInputError(
      "beta-setup-input.usage-invalid",
      "Use: merge <operator-base-v1.json> <setup-discovery.json> <new-output.json>.",
    );
  }
  const basePath = resolve(arguments_[0] ?? "");
  const discoveryPath = resolve(arguments_[1] ?? "");
  const outputPath = resolve(arguments_[2] ?? "");
  if (outputPath === basePath || outputPath === discoveryPath) {
    throw new CliInputError(
      "beta-setup-input.output-overlap",
      "Output must be a new path and cannot overwrite either input.",
    );
  }
  const [base, discovery] = await Promise.all([
    readBoundedJson(basePath, "Operator base"),
    readBoundedJson(discoveryPath, "Discovery"),
  ]);
  const result = mergeBetaSetupDiscoveryV1(base, discovery);
  if (!result.valid) {
    emit({ issues: result.issues, valid: false, warnings: result.warnings });
    return 1;
  }
  const parent = dirname(outputPath);
  let parentMetadata;
  try {
    parentMetadata = await lstat(parent);
  } catch {
    throw new CliInputError(
      "beta-setup-input.output-parent-invalid",
      "Output parent must be an existing regular directory.",
    );
  }
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new CliInputError(
      "beta-setup-input.output-parent-invalid",
      "Output parent must be an existing regular directory.",
    );
  }
  const serialized = `${JSON.stringify(result.data, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES) {
    throw new CliInputError(
      "beta-setup-input.output-size-invalid",
      "Validated deployment inputs exceed the bounded file-size policy.",
    );
  }
  try {
    await writeFile(outputPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new CliInputError(
      "beta-setup-input.output-unavailable",
      "Output must be a new writable file and is never overwritten.",
    );
  }
  emit({
    deploymentInputsDigest: result.deploymentInputsDigest,
    discoveryDigest: result.discoveryDigest,
    schemaVersion: BETA_SETUP_DISCOVERY_SCHEMA_VERSION,
    valid: true,
    warnings: result.warnings,
  });
  return 0;
}

export async function runBetaSetupCli(
  commandArguments: readonly string[],
  emit: OutputWriter = output,
): Promise<number> {
  const [command, ...arguments_] = commandArguments;
  try {
    if (command === "validate") return await validateCommand(arguments_, emit);
    if (command === "merge") return await mergeCommand(arguments_, emit);
    throw new CliInputError(
      "beta-setup-input.usage-invalid",
      "Use validate or merge with the required JSON paths.",
    );
  } catch (error) {
    const safeError =
      error instanceof CliInputError
        ? error
        : new CliInputError(
            "beta-setup-input.operation-failed",
            "The setup-input operation failed closed.",
          );
    emit({ code: safeError.code, message: safeError.message, valid: false });
    return 2;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  process.exitCode = await runBetaSetupCli(process.argv.slice(2));
}
