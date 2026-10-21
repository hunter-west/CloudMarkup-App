import type { BetaConverseUsage } from "./infrastructure-proposal-model.js";
import type { BetaApplicationSource } from "./application-source-content.js";

/** Current application-source input; authority remains with the application. */
export interface ApplicationSourceModelInputV1 {
  readonly context: unknown;
  readonly reviewed?: boolean;
  readonly semantic?: boolean;
  readonly signal: AbortSignal;
  readonly onUsage?: (usage: BetaConverseUsage) => Promise<void>;
}

/** Returns review-required source only; grants no execution or deployment. */
export type ApplicationSourceModelV1 = (
  input: ApplicationSourceModelInputV1,
) => Promise<BetaApplicationSource>;
