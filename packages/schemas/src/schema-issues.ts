import type { z } from "zod";

interface SchemaIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") {
      return `${formatted}[${String(segment)}]`;
    }

    if (typeof segment === "symbol") {
      return `${formatted}[${JSON.stringify(segment.description ?? "")}]`;
    }

    return `${formatted}.${segment}`;
  }, "$");
}

export function toSchemaIssues(error: z.ZodError): readonly SchemaIssue[] {
  return error.issues
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: formatIssuePath(issue.path),
    }))
    .sort(
      (left, right) =>
        compareUtf16(left.path, right.path) ||
        compareUtf16(left.code, right.code) ||
        compareUtf16(left.message, right.message),
    );
}
