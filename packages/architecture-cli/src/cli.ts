import {
  serializeCanonicalJson,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";

import {
  ARCHITECTURE_CLI_EXIT_CODES,
  ARCHITECTURE_CLI_LIMITS,
  architectureCliCommandV1Schema,
  architectureCliOutputFormatV1Schema,
  type ArchitectureCliCommandResultV1,
} from "./contracts.js";
import type { ArchitectureCliServiceV1 } from "./service.js";

export const ARCHITECTURE_CLI_USAGE =
  "usage: cloudmarkup <validate|generate|verify|diff|render|test|evidence|conformance|import|inspect-repository|compare|verify-repository> [--root <path>|--source <path>] [--environment <id>] [--format <human|json>]";

interface ParsedArguments {
  readonly command: Parameters<
    ArchitectureCliServiceV1["execute"]
  >[0]["command"];
  readonly format: "human" | "json";
  readonly environmentId?: string;
  readonly root: string;
}

function parseArguments(args: readonly string[]): ParsedArguments | undefined {
  const command = architectureCliCommandV1Schema.safeParse(args[0]);
  if (!command.success) return undefined;
  let environmentId: string | undefined;
  let format: "human" | "json" = "human";
  let root = ".";
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      value === undefined ||
      (option !== "--root" &&
        option !== "--source" &&
        option !== "--environment" &&
        option !== "--format") ||
      seen.has(option)
    ) {
      return undefined;
    }
    seen.add(option);
    if (option === "--root" || option === "--source") {
      if (value.includes("\u0000") || value.length > 1_024) return undefined;
      root = value;
    } else if (option === "--format") {
      const parsedFormat = architectureCliOutputFormatV1Schema.safeParse(value);
      if (!parsedFormat.success) return undefined;
      format = parsedFormat.data;
    } else {
      const parsedEnvironment = solutionStableIdSchema.safeParse(value);
      if (!parsedEnvironment.success) return undefined;
      environmentId = parsedEnvironment.data;
    }
  }
  if ((command.data === "conformance") !== (environmentId !== undefined)) {
    return undefined;
  }
  return {
    command: command.data,
    ...(environmentId === undefined ? {} : { environmentId }),
    format,
    root,
  };
}

function humanOutput(result: ArchitectureCliCommandResultV1): string {
  const lines = [
    `cloudmarkup ${result.command}: ${result.state}`,
    "Deployment: not performed; this CLI does not apply infrastructure or create CloudFormation change sets.",
    ...(result.solutionRevision === undefined
      ? []
      : [
          `Solution Revision: ${result.solutionRevision.id} (${result.solutionRevision.digest})`,
        ]),
    ...(result.conformance === undefined
      ? []
      : [
          `Conformance report: ${result.conformance.reportId} (${result.conformance.reportDigest})`,
          `Conformance differences: ${String(result.conformance.differenceIds.length)}`,
          `Conformance issues: ${String(result.conformance.issueIds.length)}`,
        ]),
    `File changes: ${String(result.fileChanges.length)}`,
    `Semantic changes: ${String(result.semanticChanges.length)}`,
    ...(result.repositoryImport === undefined
      ? []
      : [
          `Imported files: ${String(result.repositoryImport.snapshot.files.length)}`,
          `Observed facts: ${String(result.repositoryImport.facts.length)}`,
          `Repository differences: ${String(result.repositoryImport.differences.filter(({ kind }) => kind !== "matches").length)}`,
          `Repository Evidence: ${result.repositoryImport.evidence.checks[0]?.status ?? "unavailable"}`,
        ]),
    ...(result.evidence === undefined
      ? []
      : [
          `Evidence: ${String(result.evidence.current)} current, ${String(result.evidence.stale)} stale, ${String(result.evidence.failed)} failed`,
        ]),
    ...result.diagnostics.map(
      (entry) =>
        `${entry.severity.toUpperCase()} ${entry.code}${entry.path === undefined ? "" : ` [${entry.path}]`}: ${entry.message}`,
    ),
    ...result.fileChanges.map(
      (entry) => `${entry.change.toUpperCase()} ${entry.path}`,
    ),
    ...result.semanticChanges.map(
      (entry) =>
        `${entry.kind.toUpperCase()} ${entry.factId}: ${entry.summary}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export async function runArchitectureCli(input: {
  readonly args: readonly string[];
  readonly service: ArchitectureCliServiceV1;
  readonly signal?: AbortSignal;
  readonly stderr: { write(value: string): unknown };
  readonly stdout: { write(value: string): unknown };
}): Promise<number> {
  const parsed = parseArguments(input.args);
  if (parsed === undefined) {
    input.stderr.write(`${ARCHITECTURE_CLI_USAGE}\n`);
    return ARCHITECTURE_CLI_EXIT_CODES.usage;
  }
  const result = await input.service.execute({
    command: parsed.command,
    ...(parsed.environmentId === undefined
      ? {}
      : { environmentId: parsed.environmentId }),
    root: parsed.root,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const output =
    parsed.format === "json"
      ? `${serializeCanonicalJson(result)}\n`
      : humanOutput(result);
  if (
    new TextEncoder().encode(output).byteLength >
    ARCHITECTURE_CLI_LIMITS.jsonOutputBytes
  ) {
    input.stderr.write(
      "cloudmarkup: sanitized command output exceeded the configured byte limit.\n",
    );
    return ARCHITECTURE_CLI_EXIT_CODES.internal;
  }
  input.stdout.write(output);
  return result.exitCode;
}

export { humanOutput as renderArchitectureCliHumanOutput };
