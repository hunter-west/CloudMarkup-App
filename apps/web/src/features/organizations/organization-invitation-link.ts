import {
  organizationInvitationIdV1Schema,
  organizationInvitationTokenV1Schema,
} from "@cloudmarkup/api-contract";

export interface InvitationSecret {
  readonly invitationId: string;
  readonly token: string;
}

/** No query credentials, duplicate fields, decoding fallback, or persistent storage. */
export function readInvitationSecret(
  invitationId: string | undefined,
  search: string,
  hash: string,
): InvitationSecret | null {
  if (search !== "" || !hash.startsWith("#token=")) return null;
  const id = organizationInvitationIdV1Schema.safeParse(invitationId);
  const token = organizationInvitationTokenV1Schema.safeParse(hash.slice(7));
  return id.success && token.success
    ? Object.freeze({ invitationId: id.data, token: token.data })
    : null;
}
