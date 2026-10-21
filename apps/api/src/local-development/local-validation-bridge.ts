import {
  DeterministicValidationBridge,
  type DeterministicValidationBridgeOptions,
} from "../adapters/persistence/deterministic-validation-bridge.js";

export type {
  CompleteDeterministicValidationInput as CompleteLocalValidationInput,
  RevisionValidation,
} from "../application/revision-validation.js";

/** Backwards-compatible local composition over the production-safe adapter. */
export class LocalDeterministicValidationBridge extends DeterministicValidationBridge {
  constructor(
    options: Omit<DeterministicValidationBridgeOptions, "identifierNamespace">,
  ) {
    super({ ...options, identifierNamespace: "local" });
  }
}
