import type {
  AcceptedOrganizationInvitationV1,
  RecipientOrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./ports.js";
export interface RecipientInvitationPage {
  readonly items: readonly RecipientOrganizationInvitationV1[];
  readonly nextCursor?: string;
}
export interface RecipientInvitationPageInput {
  readonly limit: number;
  readonly cursor?: string;
}
export interface RecipientOrganizationInvitationApplication {
  createForRecipient(
    principal: PrincipalContext,
    organizationId: string,
    input: unknown,
    key: string,
  ): Promise<RecipientOrganizationInvitationV1>;
  listForOrganization(
    principal: PrincipalContext,
    organizationId: string,
    input: RecipientInvitationPageInput,
  ): Promise<RecipientInvitationPage>;
  listForRecipient(
    principal: PrincipalContext,
    input: RecipientInvitationPageInput,
  ): Promise<RecipientInvitationPage>;
  acceptForRecipient(
    principal: PrincipalContext,
    invitationId: string,
  ): Promise<AcceptedOrganizationInvitationV1>;
  declineForRecipient(
    principal: PrincipalContext,
    invitationId: string,
  ): Promise<RecipientOrganizationInvitationV1>;
}
