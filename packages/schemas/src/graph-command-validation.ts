import type { z } from "zod";

import { toSchemaIssues } from "./schema-issues.js";

import {
  graphCommandV1Schema,
  type GraphCommandV1,
} from "./graph-command-v1.js";

export interface GraphCommandSchemaIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export function toGraphCommandSchemaIssues(
  error: z.ZodError,
): readonly GraphCommandSchemaIssue[] {
  return toSchemaIssues(error);
}

export function formatGraphCommandSchemaIssues(
  issues: readonly GraphCommandSchemaIssue[],
): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message} [${issue.code}]`)
    .join("\n");
}

export class GraphCommandSchemaError extends Error {
  public readonly issues: readonly GraphCommandSchemaIssue[];

  public constructor(issues: readonly GraphCommandSchemaIssue[]) {
    super(formatGraphCommandSchemaIssues(issues));
    this.name = "GraphCommandSchemaError";
    this.issues = issues;
  }
}

export function parseGraphCommandV1(input: unknown): GraphCommandV1 {
  const result = graphCommandV1Schema.safeParse(input);
  if (!result.success) {
    throw new GraphCommandSchemaError(toGraphCommandSchemaIssues(result.error));
  }

  return result.data;
}

export function parseGraphCommandV1Json(serialized: string): GraphCommandV1 {
  let input: unknown;

  try {
    input = JSON.parse(serialized) as unknown;
  } catch {
    throw new GraphCommandSchemaError([
      {
        code: "invalid_json",
        message: "Must be valid JSON.",
        path: "$",
      },
    ]);
  }

  return parseGraphCommandV1(input);
}
