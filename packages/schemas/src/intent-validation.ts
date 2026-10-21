import type { z } from "zod";

import { toSchemaIssues } from "./schema-issues.js";

import {
  intentDocumentV1Schema,
  type IntentDocumentV1,
} from "./intent-document-v1.js";

export interface IntentDocumentSchemaIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export function toIntentDocumentSchemaIssues(
  error: z.ZodError,
): readonly IntentDocumentSchemaIssue[] {
  return toSchemaIssues(error);
}

export function formatIntentDocumentSchemaIssues(
  issues: readonly IntentDocumentSchemaIssue[],
): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message} [${issue.code}]`)
    .join("\n");
}

export class IntentDocumentSchemaError extends Error {
  public readonly issues: readonly IntentDocumentSchemaIssue[];

  public constructor(issues: readonly IntentDocumentSchemaIssue[]) {
    super(formatIntentDocumentSchemaIssues(issues));
    this.name = "IntentDocumentSchemaError";
    this.issues = issues;
  }
}

export function parseIntentDocumentV1(input: unknown): IntentDocumentV1 {
  const result = intentDocumentV1Schema.safeParse(input);
  if (!result.success) {
    throw new IntentDocumentSchemaError(
      toIntentDocumentSchemaIssues(result.error),
    );
  }

  return result.data;
}

export function parseIntentDocumentV1Json(
  serialized: string,
): IntentDocumentV1 {
  let input: unknown;

  try {
    input = JSON.parse(serialized) as unknown;
  } catch {
    throw new IntentDocumentSchemaError([
      {
        code: "invalid_json",
        message: "Must be valid JSON.",
        path: "$",
      },
    ]);
  }

  return parseIntentDocumentV1(input);
}
