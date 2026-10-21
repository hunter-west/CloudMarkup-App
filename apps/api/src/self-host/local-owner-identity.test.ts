import { describe, expect, it, vi } from "vitest";

import {
  LocalOwnerIdentity,
  type LocalOwnerRequestContext,
  type LocalOwnerSessionRecord,
  type LocalOwnerSessionStore,
} from "./local-owner-identity.js";

const secret = Buffer.alloc(32, 7);
const proof = secret.toString("base64url");
const ownerId = "principal_local_owner";
const origin = "http://127.0.0.1:4317";
const sameOriginPost: LocalOwnerRequestContext = {
  method: "POST",
  origin,
  fetchSite: "same-origin",
  sessionHeader: "1",
  contentType: "application/json",
};

class MemorySessions implements LocalOwnerSessionStore {
  readonly records = new Map<string, LocalOwnerSessionRecord>();
  activeOwner = true;

  create(record: LocalOwnerSessionRecord): Promise<boolean> {
    if (this.records.has(record.tokenSha256)) return Promise.resolve(false);
    this.records.set(record.tokenSha256, { ...record });
    return Promise.resolve(true);
  }

  readActive(
    tokenSha256: string,
    sessionSha256: string,
  ): Promise<LocalOwnerSessionRecord | null> {
    const record = this.records.get(tokenSha256);
    return Promise.resolve(
      record?.sessionSha256 === sessionSha256 ? record : null,
    );
  }

  revoke(tokenSha256: string): Promise<void> {
    this.records.delete(tokenSha256);
    return Promise.resolve();
  }

  isActiveOwner(principalId: string): Promise<boolean> {
    return Promise.resolve(this.activeOwner && principalId === ownerId);
  }
}

function identity(
  sessions: LocalOwnerSessionStore,
  now: () => number = () => Date.parse("2026-10-12T12:00:00.000Z"),
): LocalOwnerIdentity {
  return new LocalOwnerIdentity({
    enabled: true,
    bindHost: "127.0.0.1",
    publicOrigin: origin,
    ownerPrincipalId: ownerId,
    operatorSecret: secret,
    sessions,
    now,
  });
}

async function issueOwnerSession(service: LocalOwnerIdentity) {
  const grant = await service.issue({ ...sameOriginPost, proof });
  if (grant === null) throw Error("Expected a synthetic owner session");
  return grant;
}

describe("local owner identity", () => {
  it("requires an explicit loopback-only composition and a 32-byte operator secret", () => {
    const sessions = new MemorySessions();
    for (const change of [
      { enabled: false },
      { bindHost: "0.0.0.0" },
      { publicOrigin: "http://localhost:4317" },
      { publicOrigin: "https://example.com" },
      { operatorSecret: Buffer.alloc(16) },
      { ownerPrincipalId: "_cannot_exist_in_principals" },
      { ownerPrincipalId: "a".repeat(129) },
    ]) {
      expect(
        () =>
          new LocalOwnerIdentity({
            enabled: true,
            bindHost: "127.0.0.1",
            publicOrigin: origin,
            ownerPrincipalId: ownerId,
            operatorSecret: secret,
            sessions,
            ...change,
          }),
      ).toThrow("Invalid local owner identity configuration");
    }
    expect(
      () =>
        new LocalOwnerIdentity({
          enabled: true,
          bindHost: "127.0.0.1",
          publicOrigin: origin,
          ownerPrincipalId: "owner.example:local_1",
          operatorSecret: secret,
          sessions,
        }),
    ).not.toThrow();
  });

  it("stores only digests and resolves the same principal after re-construction", async () => {
    const sessions = new MemorySessions();
    const service = identity(sessions);
    const grant = await issueOwnerSession(service);
    expect(grant).not.toBeNull();
    expect(grant.accessToken).toMatch(/^cmlo1_[A-Za-z0-9_-]{43}$/u);
    expect(grant.expiresIn).toBe(28_800);
    expect(grant.expiresAt).toBe("2026-10-12T20:00:00.000Z");
    const stored = [...sessions.records.values()][0];
    expect(stored?.tokenSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored?.sessionSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(grant.accessToken);
    expect(JSON.stringify(stored)).not.toContain(proof);
    expect(stored).not.toHaveProperty("sessionId");

    const authorization = `Bearer ${grant.accessToken}`;
    const original = await service.resolve(authorization);
    const restarted = await identity(sessions).resolve(authorization);
    if (original === null)
      throw Error("Expected the synthetic owner principal");
    expect(original.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(original).toEqual({
      authenticatedAt: "2026-10-12T12:00:00.000Z",
      authenticationSource: "local-owner",
      expiresAt: "2026-10-12T20:00:00.000Z",
      principalId: ownerId,
      sessionId: original.sessionId,
    });
    expect(restarted).toEqual(original);
  });

  it("refuses wrong proof and unsafe requests before storage", async () => {
    const sessions = new MemorySessions();
    const create = vi.spyOn(sessions, "create");
    const service = identity(sessions);
    for (const request of [
      { ...sameOriginPost, proof: Buffer.alloc(32, 8).toString("base64url") },
      { ...sameOriginPost, proof: "short" },
      { ...sameOriginPost, proof, origin: "http://attacker.invalid" },
      { ...sameOriginPost, proof, fetchSite: "cross-site" },
      { ...sameOriginPost, proof, sessionHeader: undefined },
      { ...sameOriginPost, proof, contentType: "text/plain" },
      { ...sameOriginPost, proof, method: "GET" },
    ]) {
      await expect(service.issue(request)).resolves.toBeNull();
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects foreign tokens, malformed headers, expiry and a foreign record", async () => {
    let now = Date.parse("2026-10-12T12:00:00.000Z");
    const sessions = new MemorySessions();
    const service = identity(sessions, () => now);
    const grant = await issueOwnerSession(service);
    const authorization = `Bearer ${grant.accessToken}`;
    await expect(
      service.resolve("Bearer local-development:owner"),
    ).resolves.toBeNull();
    await expect(
      service.resolve("Bearer signed.jwt.token"),
    ).resolves.toBeNull();
    await expect(
      service.resolve("Basic " + grant.accessToken),
    ).resolves.toBeNull();
    await expect(
      service.resolve("Bearer " + "x".repeat(16_400)),
    ).resolves.toBeNull();
    const entry = [...sessions.records][0];
    if (entry === undefined)
      throw Error("Expected the synthetic session record");
    const [key, record] = entry;
    sessions.records.set(key, { ...record, principalId: "other_owner" });
    await expect(service.resolve(authorization)).resolves.toBeNull();
    sessions.records.set(key, record);
    now += 8 * 60 * 60 * 1_000;
    await expect(service.resolve(authorization)).resolves.toBeNull();
  });

  it("fails closed for deleted owners, corrupt records and durable revocation", async () => {
    const sessions = new MemorySessions();
    const service = identity(sessions);
    const grant = await issueOwnerSession(service);
    const authorization = `Bearer ${grant.accessToken}`;
    const entry = [...sessions.records][0];
    if (entry === undefined)
      throw Error("Expected the synthetic session record");
    const [key, record] = entry;
    sessions.records.set(key, {
      ...record,
      authenticatedAt: "2026-10-12T12:30:01.000Z",
    });
    await expect(service.resolve(authorization)).resolves.toBeNull();
    sessions.records.set(key, record);
    sessions.activeOwner = false;
    await expect(service.resolve(authorization)).resolves.toBeNull();
    await expect(
      service.issue({ ...sameOriginPost, proof }),
    ).resolves.toBeNull();
    sessions.activeOwner = true;
    await expect(
      service.revoke({
        ...sameOriginPost,
        origin: "http://attacker.invalid",
        authorization,
      }),
    ).resolves.toBe(false);
    await expect(service.resolve(authorization)).resolves.not.toBeNull();
    await expect(
      service.revoke({ ...sameOriginPost, authorization }),
    ).resolves.toBe(true);
    await expect(identity(sessions).resolve(authorization)).resolves.toBeNull();
  });

  it("does not turn a session-store outage into authentication or a new token", async () => {
    const sessions = new MemorySessions();
    const service = identity(sessions);
    const grant = await issueOwnerSession(service);
    const outage = new Error("synthetic session-store outage");
    vi.spyOn(sessions, "readActive").mockRejectedValue(outage);
    await expect(service.resolve(`Bearer ${grant.accessToken}`)).rejects.toBe(
      outage,
    );
    vi.spyOn(sessions, "isActiveOwner").mockRejectedValue(outage);
    await expect(service.issue({ ...sameOriginPost, proof })).rejects.toBe(
      outage,
    );
  });

  it("bounds insert collisions without returning an unpersisted token", async () => {
    const sessions = new MemorySessions();
    const create = vi.spyOn(sessions, "create").mockResolvedValue(false);
    await expect(
      identity(sessions).issue({ ...sameOriginPost, proof }),
    ).rejects.toThrow("could not be created");
    expect(create).toHaveBeenCalledTimes(3);
  });
});
