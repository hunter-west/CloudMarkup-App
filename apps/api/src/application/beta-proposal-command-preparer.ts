import {
  awsEditorCatalog,
  prepareBetaInfrastructureProposal,
} from "@cloudmarkup/provider-aws/proposals";
import type { BetaProposalCommandPreparerV1 } from "./beta-proposal-applicability.js";

/** Exactly the editor's reviewed provider engine, without presentation layout. */
export const betaProposalCommandPreparerV1: BetaProposalCommandPreparerV1 = {
  prepare(input) {
    return prepareBetaInfrastructureProposal({
      ...input,
      catalog: awsEditorCatalog,
    }).command;
  },
};
