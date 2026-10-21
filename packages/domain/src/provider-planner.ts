import type {
  CatalogId,
  ProviderId,
  RegionIdentifier,
  SemanticVersion,
} from "@cloudmarkup/schemas";

import type { IntentIR } from "./intent-document.js";

export interface ProviderPlanningTarget {
  readonly providerId: ProviderId;
  readonly catalogId: CatalogId;
  readonly catalogVersion: SemanticVersion;
  readonly region?: RegionIdentifier;
}

export interface ProviderPlanningRequest {
  readonly contractVersion: 1;
  readonly intent: IntentIR;
  readonly target: ProviderPlanningTarget;
}

/**
 * Provider-owned planning boundary.
 *
 * A proposal returned by a future implementation is not authoritative and must
 * cross the versioned deployment-graph proposal and deterministic validation
 * boundaries before any Architecture Document change can be accepted.
 */
export interface ProviderPlanner<TDeploymentGraphProposal> {
  plan(request: ProviderPlanningRequest): Promise<TDeploymentGraphProposal>;
}
