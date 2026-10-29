import type { BetaInfrastructureProposal } from "@cloudmarkup/schemas";
import type {
  BetaInfrastructureJobCreditsV1,
  BetaInfrastructureJobV1,
} from "@cloudmarkup/api-contract";
export interface ProjectCreationProposal {
  readonly architectureDigest: string;
  readonly proposal: BetaInfrastructureProposal;
  readonly applicability?: NonNullable<
    BetaInfrastructureJobV1["result"]
  >["applicability"];
  readonly credits: BetaInfrastructureJobCreditsV1 | null;
}
const pending = new Map<
  string,
  { value: ProjectCreationProposal; expires: number }
>();
/** Short-lived memory handoff. Architecture and prompts never enter a URL or browser storage. */
export function rememberProjectCreationProposal(
  projectId: string,
  value: ProjectCreationProposal,
) {
  for (const [id, entry] of pending)
    if (entry.expires < Date.now()) pending.delete(id);
  pending.set(projectId, { value, expires: Date.now() + 30 * 60_000 });
}
export function readProjectCreationProposal(
  projectId: string,
): ProjectCreationProposal | null {
  const entry = pending.get(projectId);
  if (!entry || entry.expires < Date.now()) {
    pending.delete(projectId);
    return null;
  }
  return entry.value;
}
export function forgetProjectCreationProposal(projectId: string) {
  pending.delete(projectId);
}
