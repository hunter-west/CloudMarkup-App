#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectDeploymentOutputs,
  renderDeploymentHandoff,
  serializeDeploymentOutputs,
} from "../lib/deployment-output-handoff.js";

function argumentsFor(argv: readonly string[]): {
  readonly input: string;
  readonly jsonOutput: string | undefined;
  readonly output: string;
} {
  let input: string | undefined;
  let output: string | undefined;
  let outputDirectory: string | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      value === undefined ||
      !new Set([
        "--input",
        "--output",
        "--output-directory",
        "--outputs-file",
      ]).has(flag ?? "")
    ) {
      throw new TypeError(
        "Usage: render-deployment-handoff --outputs-file <cdk-outputs.json> --output-directory <directory>",
      );
    }
    if (flag === "--input" || flag === "--outputs-file") input = value;
    if (flag === "--output") output = value;
    if (flag === "--output-directory") outputDirectory = value;
  }
  if (
    input === undefined ||
    (output === undefined && outputDirectory === undefined) ||
    (output !== undefined && outputDirectory !== undefined)
  ) {
    throw new TypeError(
      "Usage: render-deployment-handoff --outputs-file <cdk-outputs.json> --output-directory <directory>",
    );
  }
  const outputPath =
    output === undefined
      ? join(
          resolve(
            outputDirectory ??
              (() => {
                throw new TypeError("output directory is required");
              })(),
          ),
          "deployment-handoff.md",
        )
      : resolve(output);
  return {
    input: resolve(input),
    jsonOutput:
      outputDirectory === undefined
        ? undefined
        : join(resolve(outputDirectory), "deployment-outputs.json"),
    output: outputPath,
  };
}

export function run(argv: readonly string[]): void {
  const { input, jsonOutput, output } = argumentsFor(argv);
  const bytes = readFileSync(input);
  if (bytes.byteLength > 1024 * 1024) {
    throw new TypeError("CDK outputs exceed the one MiB handoff limit.");
  }
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  const outputs = collectDeploymentOutputs(value);
  const markdown = renderDeploymentHandoff(outputs);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, markdown, { encoding: "utf8" });
  if (jsonOutput !== undefined) {
    writeFileSync(jsonOutput, serializeDeploymentOutputs(outputs), {
      encoding: "utf8",
    });
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2));
}
