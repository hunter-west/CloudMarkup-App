import type { z } from "zod";

import { toSchemaIssues } from "./schema-issues.js";

import {
  architectureDocumentV1Schema,
  type ArchitectureDocumentV1,
} from "./architecture-document-v1.js";
import {
  architectureDocumentV2Schema,
  type ArchitectureDocumentV2,
} from "./architecture-document-v2.js";
import {
  architectureDocumentV3Schema,
  type ArchitectureDocumentV3,
} from "./architecture-document-v3.js";

export interface ArchitectureDocumentSchemaIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export function toArchitectureDocumentSchemaIssues(
  error: z.ZodError,
): readonly ArchitectureDocumentSchemaIssue[] {
  return toSchemaIssues(error);
}

export function formatArchitectureDocumentSchemaIssues(
  issues: readonly ArchitectureDocumentSchemaIssue[],
): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message} [${issue.code}]`)
    .join("\n");
}

export class ArchitectureDocumentSchemaError extends Error {
  public readonly issues: readonly ArchitectureDocumentSchemaIssue[];

  public constructor(issues: readonly ArchitectureDocumentSchemaIssue[]) {
    super(formatArchitectureDocumentSchemaIssues(issues));
    this.name = "ArchitectureDocumentSchemaError";
    this.issues = issues;
  }
}

export function parseArchitectureDocumentV1(
  input: unknown,
): ArchitectureDocumentV1 {
  const result = architectureDocumentV1Schema.safeParse(input);
  if (!result.success) {
    throw new ArchitectureDocumentSchemaError(
      toArchitectureDocumentSchemaIssues(result.error),
    );
  }

  return result.data;
}

export function parseArchitectureDocumentV1Json(
  serialized: string,
): ArchitectureDocumentV1 {
  let input: unknown;

  try {
    input = JSON.parse(serialized) as unknown;
  } catch {
    throw new ArchitectureDocumentSchemaError([
      {
        code: "invalid_json",
        message: "Must be valid JSON.",
        path: "$",
      },
    ]);
  }

  return parseArchitectureDocumentV1(input);
}

export function parseArchitectureDocumentV2(
  input: unknown,
): ArchitectureDocumentV2 {
  const result = architectureDocumentV2Schema.safeParse(input);
  if (!result.success) {
    throw new ArchitectureDocumentSchemaError(
      toArchitectureDocumentSchemaIssues(result.error),
    );
  }

  return result.data;
}

export function parseArchitectureDocumentV2Json(
  serialized: string,
): ArchitectureDocumentV2 {
  let input: unknown;

  try {
    input = JSON.parse(serialized) as unknown;
  } catch {
    throw new ArchitectureDocumentSchemaError([
      {
        code: "invalid_json",
        message: "Must be valid JSON.",
        path: "$",
      },
    ]);
  }

  return parseArchitectureDocumentV2(input);
}

export function parseArchitectureDocumentV3(
  input: unknown,
): ArchitectureDocumentV3 {
  const result = architectureDocumentV3Schema.safeParse(input);
  if (!result.success) {
    throw new ArchitectureDocumentSchemaError(
      toArchitectureDocumentSchemaIssues(result.error),
    );
  }

  return result.data;
}

export function parseArchitectureDocumentV3Json(
  serialized: string,
): ArchitectureDocumentV3 {
  let input: unknown;

  try {
    input = JSON.parse(serialized) as unknown;
  } catch {
    throw new ArchitectureDocumentSchemaError([
      {
        code: "invalid_json",
        message: "Must be valid JSON.",
        path: "$",
      },
    ]);
  }

  return parseArchitectureDocumentV3(input);
}
