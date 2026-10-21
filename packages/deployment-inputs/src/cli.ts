#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DEPLOYMENT_INPUTS_SCHEMA_VERSION } from "./schema.js";
import { validateDeploymentInputsV1 } from "./validator.js";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<number> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 1) {
    output({
      code: "deployment-input.usage-invalid",
      message: "Provide exactly one deployment-input JSON file.",
      valid: false,
    });
    return 2;
  }
  const inputPath = resolve(arguments_[0] ?? "");
  try {
    const metadata = await lstat(inputPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      output({
        code: "deployment-input.file-invalid",
        message: "Input must be one regular, non-link JSON file.",
        valid: false,
      });
      return 2;
    }
    if (metadata.size < 2 || metadata.size > MAX_INPUT_BYTES) {
      output({
        code: "deployment-input.file-size-invalid",
        message: "Input file size is outside the bounded validator policy.",
        valid: false,
      });
      return 2;
    }
    const serialized = await readFile(inputPath, "utf8");
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      output({
        code: "deployment-input.json-invalid",
        message: "Input must be valid UTF-8 JSON.",
        valid: false,
      });
      return 2;
    }
    const result = validateDeploymentInputsV1(value);
    if (!result.valid) {
      output({
        issues: result.issues,
        valid: false,
        warnings: result.warnings,
      });
      return 1;
    }
    output({
      digest: result.digest,
      environment: result.environment,
      schemaVersion: DEPLOYMENT_INPUTS_SCHEMA_VERSION,
      valid: true,
      warnings: result.warnings,
    });
    return 0;
  } catch {
    output({
      code: "deployment-input.file-unavailable",
      message: "Input file is unavailable to the validator.",
      valid: false,
    });
    return 2;
  }
}

process.exitCode = await main();
