import type { PrincipalContext } from "./ports.js";

/** A tab-scoped proof. Never persist or log the raw token. */
export interface ProjectEditingLeaseProof {
  readonly leaseId: string;
  readonly token: string;
}

export interface DraftWriteLeaseContext {
  readonly principal: PrincipalContext;
  /** Omitted only for the separately verified initial-project publication. */
  readonly proof?: ProjectEditingLeaseProof;
}

export type ProjectEditingLeaseState = Readonly<{
  contractVersion: 1;
  projectId: string;
}> &
  (
    | Readonly<{ state: "available" }>
    | Readonly<{ state: "held"; expiresAt: string }>
    | Readonly<{ state: "owned"; expiresAt: string; leaseId: string }>
  );

export interface ProjectEditingLeasePort {
  acquire(
    principal: PrincipalContext,
    projectId: string,
    input: Readonly<{ token: string }>,
  ): Promise<ProjectEditingLeaseState>;
  get(
    principal: PrincipalContext,
    projectId: string,
  ): Promise<Exclude<ProjectEditingLeaseState, { state: "owned" }>>;
  renew(
    principal: PrincipalContext,
    projectId: string,
    proof: ProjectEditingLeaseProof,
  ): Promise<ProjectEditingLeaseState>;
  release(
    principal: PrincipalContext,
    projectId: string,
    proof: ProjectEditingLeaseProof,
  ): Promise<ProjectEditingLeaseState>;
}
