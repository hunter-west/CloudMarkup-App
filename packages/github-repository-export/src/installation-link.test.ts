import { describe, expect, it, vi } from "vitest";

import { GitHubExportError } from "./errors.js";
import {
  FakeGitHubAppAdapter,
  FakeGitHubInstallationLinkCallbackVerifier,
  InMemoryGitHubExportStore,
  RecordingGitHubExportAuditSink,
  RecordingGitHubExportProgressSink,
} from "./fakes.js";
import { sha256Digest } from "./security.js";
import { GitHubRepositoryExportService } from "./service.js";

const ORGANIZATION_ID = "organization.installation-link";
const PRINCIPAL_ID = "principal.installation-link";
const INITIAL_TIME = new Date("2026-08-24T12:00:00.000Z");

function expectedError(
  code: GitHubExportError["code"],
): Pick<GitHubExportError, "code"> {
  return { code };
}

function setup(
  options: {
    readonly installationSetupUrl?: string;
    readonly verifier?: boolean;
  } = {},
) {
  let now = new Date(INITIAL_TIME);
  let stateSequence = 0;
  let intentSequence = 0;
  let integrationSequence = 0;
  const github = new FakeGitHubAppAdapter();
  github.addInstallation({
    accountId: 501,
    accountLogin: "customer-org",
    accountType: "Organization",
    installationId: 77,
    permissions: {
      contents: "write",
      metadata: "read",
      pullRequests: "write",
      workflows: "none",
    },
    repositorySelection: "selected",
    suspended: false,
  });
  const callbackVerifier = new FakeGitHubInstallationLinkCallbackVerifier();
  const store = new InMemoryGitHubExportStore();
  const audit = new RecordingGitHubExportAuditSink();
  const service = new GitHubRepositoryExportService({
    artifactRepository: { getApprovedPackage: () => Promise.resolve(null) },
    audit,
    clock: () => new Date(now),
    github,
    idFactory: () => `integration.${String(++integrationSequence)}`,
    ...(options.verifier === false
      ? {}
      : { installationLinkCallbackVerifier: callbackVerifier }),
    installationSetupUrl:
      options.installationSetupUrl ??
      "https://github.com/apps/cloudmarkup-test/installations/new",
    linkIntentIdFactory: () => `githublink_${String(++intentSequence)}`,
    linkStateFactory: () =>
      `${String(++stateSequence).padStart(2, "0")}${"s".repeat(41)}`,
    progress: new RecordingGitHubExportProgressSink(),
    store,
  });
  return {
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
    audit,
    callbackVerifier,
    github,
    service,
    store,
  };
}

async function createProof(
  value: ReturnType<typeof setup>,
  options: {
    readonly organizationId?: string;
    readonly principalId?: string;
    readonly receipt?: string;
    readonly state?: string;
  } = {},
) {
  const organizationId = options.organizationId ?? ORGANIZATION_ID;
  const principalId = options.principalId ?? PRINCIPAL_ID;
  const intent = await value.service.createInstallationLinkIntent({
    correlationId: "correlation.intent",
    organizationId,
    principalId,
  });
  const receipt = options.receipt ?? `receipt.${intent.intentId}`;
  value.callbackVerifier.addReceipt(receipt, {
    installationId: 77,
    setupAction: "install",
    state: options.state ?? intent.state,
  });
  return { intent, organizationId, principalId, receipt };
}

async function complete(
  value: ReturnType<typeof setup>,
  proof: Awaited<ReturnType<typeof createProof>>,
) {
  return value.service.completeInstallationLink({
    callbackReceipt: proof.receipt,
    correlationId: "correlation.complete",
    intentId: proof.intent.intentId,
    organizationId: proof.organizationId,
    principalId: proof.principalId,
  });
}

describe("GitHub App installation link authority", () => {
  it("issues a short-lived state-bound GitHub App URL while storing only the digest", async () => {
    const value = setup();
    const { intent } = await createProof(value);

    expect(intent.installationUrl).toBe(
      `https://github.com/apps/cloudmarkup-test/installations/new?state=${intent.state}`,
    );
    expect(Date.parse(intent.expiresAt) - INITIAL_TIME.getTime()).toBe(600_000);
    const stored = value.store.installationLinkIntents.get(intent.intentId);
    expect(stored?.stateDigest).toBe(sha256Digest(intent.state));
    expect(JSON.stringify(stored)).not.toContain(intent.state);
  });

  it("links exactly the verified callback installation and safely replays a completed result", async () => {
    const value = setup();
    const proof = await createProof(value);

    const first = await complete(value, proof);
    const replay = await complete(value, proof);

    expect(replay).toEqual(first);
    expect(
      value.store.installationLinkIntents.get(proof.intent.intentId),
    ).toMatchObject({
      completedInstallationId: 77,
      completedIntegrationId: first.integrationId,
      state: "completed",
    });
  });

  it("rejects guessed legacy installation-ID linking before inspection", async () => {
    const value = setup();

    await expect(
      value.service.linkInstallation({
        correlationId: "correlation.legacy",
        installationId: 77,
        organizationId: ORGANIZATION_ID,
        principalId: PRINCIPAL_ID,
      }),
    ).rejects.toMatchObject(expectedError("installation-link-invalid"));
    expect(value.store.installations.size).toBe(0);
    expect(value.audit.events.at(-1)?.action).toBe(
      "github.installation.legacy-link-denied",
    );
  });

  it.each([
    ["another organization", "organization.other", PRINCIPAL_ID],
    ["another principal", ORGANIZATION_ID, "principal.other"],
  ])(
    "rejects the exact state when replayed by %s",
    async (_label, organizationId, principalId) => {
      const value = setup();
      const proof = await createProof(value);

      await expect(
        value.service.completeInstallationLink({
          callbackReceipt: proof.receipt,
          correlationId: "correlation.cross-boundary",
          intentId: proof.intent.intentId,
          organizationId,
          principalId,
        }),
      ).rejects.toMatchObject(expectedError("installation-link-invalid"));
      await expect(complete(value, proof)).resolves.toMatchObject({
        installationId: 77,
      });
    },
  );

  it("rejects a tampered callback state without consuming the real intent", async () => {
    const value = setup();
    const proof = await createProof(value);
    const tamperedReceipt = "receipt.tampered-state";
    value.callbackVerifier.addReceipt(tamperedReceipt, {
      installationId: 77,
      setupAction: "install",
      state: `99${"x".repeat(41)}`,
    });

    await expect(
      value.service.completeInstallationLink({
        callbackReceipt: tamperedReceipt,
        correlationId: "correlation.tampered",
        intentId: proof.intent.intentId,
        organizationId: ORGANIZATION_ID,
        principalId: PRINCIPAL_ID,
      }),
    ).rejects.toMatchObject(expectedError("installation-link-invalid"));
    await expect(complete(value, proof)).resolves.toMatchObject({
      installationId: 77,
    });
  });

  it("expires the state and never inspects the callback installation", async () => {
    const value = setup();
    const proof = await createProof(value);
    value.advance(600_001);

    await expect(complete(value, proof)).rejects.toMatchObject(
      expectedError("installation-link-expired"),
    );
    expect(value.store.installations.size).toBe(0);
  });

  it.each(["before-commit", "after-commit"] as const)(
    "recovers a %s consume failure and retries the exact same receipt",
    async (failurePoint) => {
      const value = setup();
      const proof = await createProof(value);
      value.store.failNextInstallationLinkConsumption(failurePoint);

      await expect(complete(value, proof)).rejects.toMatchObject(
        expectedError("service-unavailable"),
      );
      expect(
        value.store.installationLinkIntents.get(proof.intent.intentId)?.state,
      ).toBe("pending");

      await expect(complete(value, proof)).resolves.toMatchObject({
        installationId: 77,
      });
    },
  );

  it("releases an exact unexpired intent after transient inspection failure and retries the same receipt", async () => {
    const value = setup();
    const proof = await createProof(value);
    value.github.failNext("inspect-installation");

    await expect(complete(value, proof)).rejects.toMatchObject(
      expectedError("service-unavailable"),
    );
    expect(
      value.store.installationLinkIntents.get(proof.intent.intentId)?.state,
    ).toBe("pending");
    await expect(complete(value, proof)).resolves.toMatchObject({
      installationId: 77,
    });
  });

  it("rolls back a transient finalization failure, releases the intent, and retries", async () => {
    const value = setup();
    const proof = await createProof(value);
    value.store.failNextInstallationLinkFinalization("before-commit");

    await expect(complete(value, proof)).rejects.toMatchObject(
      expectedError("service-unavailable"),
    );
    expect(value.store.installations.size).toBe(0);
    expect(
      value.store.installationLinkIntents.get(proof.intent.intentId)?.state,
    ).toBe("pending");
    await expect(complete(value, proof)).resolves.toMatchObject({
      installationId: 77,
    });
  });

  it("returns the exact completed installation when the finalization response was lost", async () => {
    const value = setup();
    const proof = await createProof(value);
    value.store.failNextInstallationLinkFinalization("after-commit");

    await expect(complete(value, proof)).rejects.toMatchObject(
      expectedError("service-unavailable"),
    );
    expect(
      value.store.installationLinkIntents.get(proof.intent.intentId),
    ).toMatchObject({ state: "completed" });
    expect(value.store.installations.size).toBe(1);

    const replay = await complete(value, proof);
    expect(replay).toMatchObject({
      installationId: 77,
      integrationId: "integration.1",
    });
    expect(value.store.installations.size).toBe(1);
  });

  it("records an idempotent recovery audit when finalization committed before the success audit failed", async () => {
    const value = setup();
    const proof = await createProof(value);
    value.audit.failNext("github.installation.linked");

    await expect(complete(value, proof)).rejects.toMatchObject(
      expectedError("service-unavailable"),
    );
    expect(
      value.store.installationLinkIntents.get(proof.intent.intentId)?.state,
    ).toBe("completed");
    expect(value.audit.events).not.toContainEqual(
      expect.objectContaining({ action: "github.installation.linked" }),
    );

    const recovered = await complete(value, proof);
    expect(value.audit.events.at(-1)).toMatchObject({
      action: "github.installation-link.recovered",
      organizationId: ORGANIZATION_ID,
      outcome: "succeeded",
      principalId: PRINCIPAL_ID,
      targetId: recovered.integrationId,
    });
  });

  it("does not release a permanently mismatched installation descriptor", async () => {
    const value = setup();
    const proof = await createProof(value);
    vi.spyOn(value.github, "inspectInstallation").mockResolvedValueOnce({
      accountId: 501,
      accountLogin: "customer-org",
      accountType: "Organization",
      installationId: 88,
      permissions: {
        contents: "write",
        metadata: "read",
        pullRequests: "write",
        workflows: "none",
      },
      repositorySelection: "selected",
      suspended: false,
    });

    await expect(complete(value, proof)).rejects.toMatchObject(
      expectedError("installation-link-invalid"),
    );
    expect(
      value.store.installationLinkIntents.get(proof.intent.intentId)?.state,
    ).toBe("consumed");
    await expect(complete(value, proof)).rejects.toMatchObject(
      expectedError("installation-link-replayed"),
    );
  });

  it("rejects an installation already linked to another organization but preserves same-org duplicate completion", async () => {
    const value = setup();
    const first = await createProof(value);
    const installation = await complete(value, first);
    const sameOrganization = await createProof(value);
    await expect(complete(value, sameOrganization)).resolves.toMatchObject({
      integrationId: installation.integrationId,
    });

    const otherOrganization = await createProof(value, {
      organizationId: "organization.other",
      principalId: "principal.other",
    });
    await expect(complete(value, otherOrganization)).rejects.toMatchObject(
      expectedError("installation-link-invalid"),
    );
    expect(
      value.store.installationLinkIntents.get(otherOrganization.intent.intentId)
        ?.state,
    ).toBe("consumed");
    await expect(complete(value, otherOrganization)).rejects.toMatchObject(
      expectedError("installation-link-replayed"),
    );
  });

  it("rejects an arbitrary or pre-parameterized installation setup URL", async () => {
    for (const installationSetupUrl of [
      "https://attacker.example/apps/cloudmarkup/installations/new",
      "https://github.com/apps/cloudmarkup/installations/new?return_to=attacker",
    ]) {
      const value = setup({ installationSetupUrl });
      await expect(
        value.service.createInstallationLinkIntent({
          correlationId: "correlation.invalid-url",
          organizationId: ORGANIZATION_ID,
          principalId: PRINCIPAL_ID,
        }),
      ).rejects.toMatchObject(expectedError("service-unavailable"));
      expect(value.store.installationLinkIntents.size).toBe(0);
    }
  });

  it("fails closed when no trusted callback verifier is composed", async () => {
    const value = setup({ verifier: false });
    const intent = await value.service.createInstallationLinkIntent({
      correlationId: "correlation.intent",
      organizationId: ORGANIZATION_ID,
      principalId: PRINCIPAL_ID,
    });

    await expect(
      value.service.completeInstallationLink({
        callbackReceipt: "untrusted.callback.receipt",
        correlationId: "correlation.unavailable",
        intentId: intent.intentId,
        organizationId: ORGANIZATION_ID,
        principalId: PRINCIPAL_ID,
      }),
    ).rejects.toMatchObject(expectedError("service-unavailable"));
    expect(
      value.store.installationLinkIntents.get(intent.intentId)?.state,
    ).toBe("pending");
  });
});
