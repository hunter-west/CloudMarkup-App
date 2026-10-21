import { createHash } from "node:crypto";
import {
  acceptOrganizationInvitationV1Schema,
  acceptedOrganizationInvitationV1Schema,
  createOrganizationInvitationV1Schema,
  idempotencyKeySchema,
  organizationIdSchema,
  organizationInvitationIdV1Schema,
  organizationInvitationV1Schema,
  type AcceptedOrganizationInvitationV1,
  type OrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import type { InvitableOrganizationRoleV1 } from "@cloudmarkup/domain";
import { ApplicationError } from "./errors.js";
import { requireRecentAuthentication } from "./identity.js";
import type { PrincipalContext } from "./ports.js";

export interface CreateOrganizationInvitationRecordV1 {
  /** Set only by the recipient-bound admission adapter after exact identity resolution. */
  readonly recipientPrincipalId?: string;
  readonly organizationId: string;
  readonly role: InvitableOrganizationRoleV1;
  readonly tokenSha256: string;
  readonly requestSha256: string;
  readonly idempotencyKeySha256: string;
}
/** Trusted storage rechecks all current authority under the admission transaction. */
export interface OrganizationInvitationRepository {
  create(
    principal: PrincipalContext,
    input: CreateOrganizationInvitationRecordV1,
  ): Promise<OrganizationInvitationV1>;
  revoke(
    principal: PrincipalContext,
    organizationId: string,
    invitationId: string,
  ): Promise<OrganizationInvitationV1>;
  accept(
    principal: PrincipalContext,
    invitationId: string,
    tokenSha256: string,
  ): Promise<AcceptedOrganizationInvitationV1>;
}

function digest(kind: string, values: readonly string[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(["organization-invitation-v1", kind, ...values]),
      "utf8",
    )
    .digest("hex");
}

export class OrganizationInvitationApplication {
  readonly #repository: OrganizationInvitationRepository;
  readonly #now: () => Date;
  constructor(options: {
    readonly repository: OrganizationInvitationRepository;
    readonly now?: () => Date;
  }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }
  #principal(input: PrincipalContext): PrincipalContext {
    const principal = Object.freeze({
      principalId: input.principalId,
      sessionId: input.sessionId,
      authenticatedAt: input.authenticatedAt,
      expiresAt: input.expiresAt,
      authenticationSource: input.authenticationSource,
      correlationId: input.correlationId,
    });
    const now = this.#now();
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(Date.parse(principal.expiresAt)) ||
      Date.parse(principal.expiresAt) <= now.getTime()
    ) {
      throw new ApplicationError(
        "authentication_required",
        "Sign in to continue.",
      );
    }
    requireRecentAuthentication(principal, now);
    return principal;
  }
  async create(
    principal: PrincipalContext,
    organizationId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<OrganizationInvitationV1> {
    const actor = this.#principal(principal);
    const parsed = createOrganizationInvitationV1Schema.safeParse(input);
    if (
      !parsed.success ||
      !organizationIdSchema.safeParse(organizationId).success ||
      !idempotencyKeySchema.safeParse(idempotencyKey).success
    ) {
      throw new ApplicationError(
        "invalid_request",
        "The invitation request is invalid.",
      );
    }
    const tokenSha256 = digest("secret", [parsed.data.token]);
    // Only closed metadata crosses into storage. No body, secret or URL is retained.
    const result = await this.#repository.create(
      actor,
      Object.freeze({
        organizationId,
        role: parsed.data.role,
        tokenSha256,
        requestSha256: digest("create", [
          organizationId,
          actor.principalId,
          parsed.data.role,
          tokenSha256,
        ]),
        idempotencyKeySha256: digest("idempotency", [
          organizationId,
          actor.principalId,
          idempotencyKey,
        ]),
      }),
    );
    const decoded = organizationInvitationV1Schema.safeParse(result);
    if (!decoded.success)
      throw new ApplicationError(
        "service_unavailable",
        "The invitation is unavailable.",
      );
    const value = decoded.data;
    if (
      value.organizationId !== organizationId ||
      value.role !== parsed.data.role
    )
      throw new ApplicationError(
        "service_unavailable",
        "The invitation is unavailable.",
      );
    return value;
  }
  async revoke(
    principal: PrincipalContext,
    organizationId: string,
    invitationId: string,
  ): Promise<OrganizationInvitationV1> {
    const actor = this.#principal(principal);
    if (
      !organizationIdSchema.safeParse(organizationId).success ||
      !organizationInvitationIdV1Schema.safeParse(invitationId).success
    )
      throw new ApplicationError(
        "invalid_request",
        "The invitation request is invalid.",
      );
    const decoded = organizationInvitationV1Schema.safeParse(
      await this.#repository.revoke(actor, organizationId, invitationId),
    );
    if (!decoded.success)
      throw new ApplicationError(
        "service_unavailable",
        "The invitation is unavailable.",
      );
    const value = decoded.data;
    if (value.id !== invitationId || value.organizationId !== organizationId)
      throw new ApplicationError(
        "service_unavailable",
        "The invitation is unavailable.",
      );
    return value;
  }
  async accept(
    principal: PrincipalContext,
    invitationId: string,
    input: unknown,
  ): Promise<AcceptedOrganizationInvitationV1> {
    const actor = this.#principal(principal);
    const parsed = acceptOrganizationInvitationV1Schema.safeParse(input);
    if (
      !parsed.success ||
      !organizationInvitationIdV1Schema.safeParse(invitationId).success
    )
      throw new ApplicationError(
        "invalid_request",
        "The invitation request is invalid.",
      );
    const decoded = acceptedOrganizationInvitationV1Schema.safeParse(
      await this.#repository.accept(
        actor,
        invitationId,
        digest("secret", [parsed.data.token]),
      ),
    );
    if (!decoded.success)
      throw new ApplicationError(
        "service_unavailable",
        "The invitation is unavailable.",
      );
    return decoded.data;
  }
}
