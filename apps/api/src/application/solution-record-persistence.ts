import type {
  AuthorizedOrganizationScope,
  StoredObjectReference,
} from "./persistence.js";

export const SOLUTION_RECORD_KINDS = [
  "repository-snapshot",
  "observed-solution",
  "reconciliation-proposal",
  "solution-revision-manifest",
  "ai-authored-extension",
  "active-issue",
  "evidence",
] as const;

export type SolutionRecordKind = (typeof SOLUTION_RECORD_KINDS)[number];

export function isSolutionRecordKind(
  value: string,
): value is SolutionRecordKind {
  return SOLUTION_RECORD_KINDS.some((kind) => kind === value);
}

export interface CreateSolutionRecordInput {
  readonly architectureRevisionId?: string;
  readonly contentSha256: string;
  readonly contractVersion: number;
  readonly idempotencyKey: string;
  readonly previousSolutionRecordId?: string;
  readonly projectId: string;
  readonly recordKind: SolutionRecordKind;
  readonly requestSha256: string;
  readonly solutionRecordId: string;
  readonly subjectId: string;
}

export interface SolutionRecordMetadata extends Omit<
  CreateSolutionRecordInput,
  "idempotencyKey" | "requestSha256"
> {
  readonly contentObjectId: string;
  readonly createdAt: string;
  readonly createdByPrincipalId: string;
  readonly organizationId: string;
}

export interface ListSolutionRecordsInput {
  readonly limit: number;
  readonly projectId: string;
  readonly recordKind?: SolutionRecordKind;
  readonly subjectId?: string;
}

export interface SolutionRecordRepository {
  create(
    scope: AuthorizedOrganizationScope,
    input: CreateSolutionRecordInput,
    object: StoredObjectReference,
  ): Promise<SolutionRecordMetadata>;

  get(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    solutionRecordId: string,
  ): Promise<SolutionRecordMetadata | null>;

  /** Mutation-only lookup for an exact interrupted manifest publication. */
  getManifestForPublication?(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    solutionRecordId: string,
  ): Promise<SolutionRecordMetadata | null>;

  list(
    scope: AuthorizedOrganizationScope,
    input: ListSolutionRecordsInput,
  ): Promise<readonly SolutionRecordMetadata[]>;
}
