import type {
  BillingWorkspaceV1,
  CreditTopUpWorkspaceV1,
  CreateCreditTopUpV1,
  CreateBillingCheckoutV1,
  HostedBillingSessionV1,
} from "@cloudmarkup/api-contract";

import type { PrincipalContext } from "./ports.js";

export interface BillingWorkspaceApplication {
  getCreditTopUps?(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<CreditTopUpWorkspaceV1>;
  createCreditTopUp?(
    principal: PrincipalContext,
    organizationId: string,
    input: CreateCreditTopUpV1,
    idempotencyKey: string,
  ): Promise<HostedBillingSessionV1>;
  getWorkspace(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<BillingWorkspaceV1>;
  createCheckout(
    principal: PrincipalContext,
    organizationId: string,
    input: CreateBillingCheckoutV1,
    idempotencyKey: string,
  ): Promise<HostedBillingSessionV1>;
  createPortal(
    principal: PrincipalContext,
    organizationId: string,
    idempotencyKey: string,
  ): Promise<HostedBillingSessionV1>;
}
