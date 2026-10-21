import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  parseBearerToken,
  type Principal,
  type PrincipalResolver,
} from "../application/identity.js";

const ACCESS_PREFIX = "cmlo1_";
const ACCESS_TOKEN = /^cmlo1_[A-Za-z0-9_-]{43}$/u;
const SECRET_PROOF = /^[A-Za-z0-9_-]{43}$/u;
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/u;
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;
const FUTURE_CLOCK_SKEW_MS = 30_000;

/** The implementation must persist records, insert unique digests atomically,
 * read only unrevoked records, and make revocation durable. It must not store
 * plaintext bearer tokens or the operator bootstrap secret. */
export interface LocalOwnerSessionStore {
  create(record: LocalOwnerSessionRecord): Promise<boolean>;
  readActive(
    tokenSha256: string,
    sessionSha256: string,
  ): Promise<LocalOwnerSessionRecord | null>;
  revoke(tokenSha256: string): Promise<void>;
  isActiveOwner(principalId: string): Promise<boolean>;
}

export interface LocalOwnerSessionRecord {
  readonly tokenSha256: string;
  readonly principalId: string;
  readonly sessionSha256: string;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
}

export interface LocalOwnerRequestContext {
  readonly method: string;
  readonly origin: string | undefined;
  readonly fetchSite: string | undefined;
  readonly sessionHeader: string | undefined;
  readonly contentType: string | undefined;
}

export interface LocalOwnerIdentityOptions {
  readonly enabled: boolean;
  readonly bindHost: string;
  readonly publicOrigin: string;
  readonly ownerPrincipalId: string;
  /** Exactly 32 operator-generated random bytes, loaded server-side. */
  readonly operatorSecret: Uint8Array;
  readonly sessions: LocalOwnerSessionStore;
  readonly now?: () => number;
}

export interface LocalOwnerAccessGrant {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly expiresIn: number;
}

function digest(token: string): string {
  return createHash("sha256")
    .update("cloudmarkup-local-owner-access-v1\0")
    .update(token)
    .digest("hex");
}

function sessionId(token: string): string {
  return createHash("sha256")
    .update("cloudmarkup-local-owner-family-v1\0")
    .update(token)
    .digest("base64url");
}

function sessionDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalProof(value: string): Buffer | null {
  if (!SECRET_PROOF.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value
    ? bytes
    : null;
}

function canonicalTime(value: string): number | null {
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) &&
    new Date(milliseconds).toISOString() === value
    ? milliseconds
    : null;
}

/** Local identity primitive. Hosted composition must not construct it. A
 * local entrypoint must pass real request headers to issue
 * and revoke, provide a durable session store, and keep the proof out of URLs,
 * logs, browser bundles and long-lived browser storage. */
export class LocalOwnerIdentity implements PrincipalResolver {
  readonly #ownerPrincipalId: string;
  readonly #operatorSecret: Buffer;
  readonly #publicOrigin: string;
  readonly #sessions: LocalOwnerSessionStore;
  readonly #now: () => number;

  constructor(options: LocalOwnerIdentityOptions) {
    const enabled: unknown = options.enabled;
    let origin: URL;
    try {
      origin = new URL(options.publicOrigin);
    } catch {
      throw new TypeError("Invalid local owner identity configuration.");
    }
    if (
      enabled !== true ||
      options.bindHost !== "127.0.0.1" ||
      origin.hostname !== "127.0.0.1" ||
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== options.publicOrigin ||
      origin.pathname !== "/" ||
      origin.username !== "" ||
      origin.password !== "" ||
      // Mirror principals.principal_id from canonical migration 0001 so an
      // operator cannot configure an owner that the database cannot contain.
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(options.ownerPrincipalId) ||
      options.operatorSecret.length !== 32
    ) {
      throw new TypeError("Invalid local owner identity configuration.");
    }
    this.#ownerPrincipalId = options.ownerPrincipalId;
    this.#operatorSecret = Buffer.from(options.operatorSecret);
    this.#publicOrigin = options.publicOrigin;
    this.#sessions = options.sessions;
    this.#now = options.now ?? Date.now;
  }

  #sameOriginPost(request: LocalOwnerRequestContext): boolean {
    return (
      request.method === "POST" &&
      request.origin === this.#publicOrigin &&
      (request.fetchSite === undefined ||
        request.fetchSite === "same-origin") &&
      request.sessionHeader === "1" &&
      /^application\/json(?:\s*;|$)/iu.test(request.contentType ?? "")
    );
  }

  /** A caller supplies the operator's proof via a same-origin JSON POST.
   * Invalid proof and unavailable owner both refuse without issuing access. */
  async issue(
    request: LocalOwnerRequestContext & { readonly proof: string },
  ): Promise<LocalOwnerAccessGrant | null> {
    if (!this.#sameOriginPost(request)) return null;
    const proof = canonicalProof(request.proof);
    if (
      proof === null ||
      !timingSafeEqual(proof, this.#operatorSecret) ||
      !(await this.#sessions.isActiveOwner(this.#ownerPrincipalId))
    )
      return null;

    const now = this.#now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now + SESSION_LIFETIME_MS > 8_640_000_000_000_000
    )
      throw new Error("Local owner clock is unavailable.");
    const authenticatedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + SESSION_LIFETIME_MS).toISOString();
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = ACCESS_PREFIX + randomBytes(32).toString("base64url");
      const record: LocalOwnerSessionRecord = {
        tokenSha256: digest(token),
        principalId: this.#ownerPrincipalId,
        sessionSha256: sessionDigest(sessionId(token)),
        authenticatedAt,
        expiresAt,
      };
      if (await this.#sessions.create(record)) {
        return {
          accessToken: token,
          expiresAt,
          expiresIn: SESSION_LIFETIME_MS / 1_000,
        };
      }
    }
    throw new Error("Local owner session could not be created.");
  }

  async resolve(authorization: string | undefined): Promise<Principal | null> {
    const token = parseBearerToken(authorization);
    if (token === null || !ACCESS_TOKEN.test(token)) return null;
    const currentSessionId = sessionId(token);
    const currentSessionSha256 = sessionDigest(currentSessionId);
    const record = await this.#sessions.readActive(
      digest(token),
      currentSessionSha256,
    );
    if (record === null) return null;
    const authenticatedAt = canonicalTime(record.authenticatedAt);
    const expiresAt = canonicalTime(record.expiresAt);
    const now = this.#now();
    if (
      record.tokenSha256 !== digest(token) ||
      record.principalId !== this.#ownerPrincipalId ||
      record.sessionSha256 !== currentSessionSha256 ||
      !SESSION_ID.test(currentSessionId) ||
      authenticatedAt === null ||
      expiresAt === null ||
      !Number.isSafeInteger(now) ||
      authenticatedAt > now + FUTURE_CLOCK_SKEW_MS ||
      expiresAt <= now ||
      expiresAt <= authenticatedAt ||
      expiresAt > authenticatedAt + SESSION_LIFETIME_MS ||
      !(await this.#sessions.isActiveOwner(this.#ownerPrincipalId))
    )
      return null;
    return {
      authenticatedAt: record.authenticatedAt,
      authenticationSource: "local-owner",
      expiresAt: record.expiresAt,
      principalId: this.#ownerPrincipalId,
      sessionId: currentSessionId,
    };
  }

  async revoke(
    request: LocalOwnerRequestContext & {
      readonly authorization: string | undefined;
    },
  ): Promise<boolean> {
    if (!this.#sameOriginPost(request)) return false;
    const token = parseBearerToken(request.authorization);
    if (token === null || !ACCESS_TOKEN.test(token)) return false;
    await this.#sessions.revoke(digest(token));
    return true;
  }
}
