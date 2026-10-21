import type { ResolvedOperation, ResolvedWorkload } from "./source-emitter.js";

export type ResolvedHttpNoContentOperation = Omit<
  ResolvedOperation,
  | "dataOperation"
  | "consistentRead"
  | "dataEdgeId"
  | "tableEnvironmentName"
  | "entity"
  | "event"
  | "notFoundStatus"
> & { readonly dataOperation: "none" };

export type ResolvedHttpNoContentWorkload = Omit<
  ResolvedWorkload,
  "operations" | "eventPattern"
> & {
  readonly patternKind: "http-no-content";
  readonly eventPattern?: never;
  readonly operations: readonly ResolvedHttpNoContentOperation[];
  readonly authenticationEdgeIds: readonly string[];
};
export type ResolvedApplicationWorkload =
  ResolvedWorkload | ResolvedHttpNoContentWorkload;
export function isHttpNoContentWorkload(
  workload: ResolvedApplicationWorkload,
): workload is ResolvedHttpNoContentWorkload {
  return "patternKind" in workload;
}
