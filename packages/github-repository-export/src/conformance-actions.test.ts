import { describe, expect, it } from "vitest";

import {
  GitHubConformanceActionError,
  GitHubConformanceActionService,
  gitHubConformanceActionRequestV1Schema,
  type GitHubConformanceActionBindingV1,
} from "./conformance-actions.js";
import {
  FakeGitHubConformanceActionAuthorization,
  FakeGitHubConformanceActionPort,
  InMemoryGitHubConformanceKnownActionStore,
  InMemoryGitHubConformanceActionReceiptStore,
} from "./conformance-actions-fakes.js";
import { canonicalDigest } from "./security.js";

const principalId = "principal.1";
const binding: GitHubConformanceActionBindingV1 = {
  evidenceRecordIds: ["evidence.1", "evidence.2"],
  organizationId: "organization.1",
  projectId: "project.1",
  reportDigest: canonicalDigest("report.1"),
  repositoryId: 900,
  solutionRevision: {
    digest: canonicalDigest("revision.1"),
    id: "solution_revision.1",
  },
};

function dependencies(input?: { readonly allow?: boolean }) {
  const actions = new FakeGitHubConformanceActionPort();
  const authorization = new FakeGitHubConformanceActionAuthorization(
    input?.allow === false ? [] : [{ binding, principalId }],
  );
  const receipts = new InMemoryGitHubConformanceActionReceiptStore();
  const knownActions = new InMemoryGitHubConformanceKnownActionStore([
    {
      action: issueRequest().action,
      binding,
      sourceRecordDigest: canonicalDigest("difference.generated-files"),
    },
  ]);
  return {
    actions,
    authorization,
    knownActions,
    receipts,
    service: new GitHubConformanceActionService({
      actions,
      authorization,
      knownActions,
      now: () => new Date("2026-08-29T12:00:00.000Z"),
      receipts,
    }),
  };
}

function issueRequest(nextBinding: GitHubConformanceActionBindingV1 = binding) {
  return {
    action: {
      actionId: "action.issue.1",
      findingClass: "generated-drift" as const,
      issueKey: "conformance.generated-files",
      kind: "upsert-known-issue" as const,
    },
    binding: nextBinding,
    contractVersion: 1 as const,
    principalId,
  };
}

describe("GitHub conformance actions", () => {
  it("upserts only a known issue and replays the exact request idempotently", async () => {
    const fixture = dependencies();
    const first = await fixture.service.execute(issueRequest(), binding);
    const second = await fixture.service.execute(
      structuredClone(issueRequest()),
      structuredClone(binding),
    );

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      actionKind: "upsert-known-issue",
      mergeAuthority: "none",
      providerState: "created",
      remediation: "none",
    });
    expect(fixture.actions.issueCalls).toHaveLength(1);
    expect(fixture.authorization.decisions).toHaveLength(2);
    expect(fixture.receipts.size).toBe(1);
    expect(fixture.actions.issueCalls[0]).toMatchObject({
      labels: ["cloudmarkup-conformance"],
      summary: "A reviewed conformance report requires attention.",
      title: "CloudMarkup conformance finding",
    });
  });

  it("updates the same known issue for a newly bound report without duplicating records", async () => {
    const fixture = dependencies();
    await fixture.service.execute(issueRequest(), binding);
    const nextBinding = {
      ...binding,
      reportDigest: canonicalDigest("report.2"),
    };
    const nextRequest = {
      ...issueRequest(nextBinding),
      action: {
        ...issueRequest(nextBinding).action,
        actionId: "action.issue.2",
      },
    };
    fixture.knownActions.register({
      action: nextRequest.action,
      binding: nextBinding,
      sourceRecordDigest: canonicalDigest("difference.generated-files"),
    });
    const nextAuthorization = new FakeGitHubConformanceActionAuthorization([
      { binding: nextBinding, principalId },
    ]);
    const nextService = new GitHubConformanceActionService({
      actions: fixture.actions,
      authorization: nextAuthorization,
      knownActions: fixture.knownActions,
      now: () => new Date("2026-08-29T12:01:00.000Z"),
      receipts: fixture.receipts,
    });
    const receipt = await nextService.execute(nextRequest, nextBinding);

    expect(receipt.providerState).toBe("updated");
    expect(fixture.actions.issueCalls).toHaveLength(2);
    expect(fixture.receipts.size).toBe(2);
  });

  it("fails closed on exact binding mismatch and authorization denial", async () => {
    const fixture = dependencies();
    const wrongBinding = { ...binding, projectId: "project.2" };
    await expect(
      fixture.service.execute(issueRequest(), wrongBinding),
    ).rejects.toMatchObject({
      code: "binding-mismatch",
    } satisfies Partial<GitHubConformanceActionError>);
    expect(fixture.authorization.decisions).toHaveLength(0);
    expect(fixture.actions.issueCalls).toHaveLength(0);

    const denied = dependencies({ allow: false });
    await expect(
      denied.service.execute(issueRequest(), binding),
    ).rejects.toMatchObject({
      code: "authorization-denied",
    } satisfies Partial<GitHubConformanceActionError>);
    expect(denied.actions.issueCalls).toHaveLength(0);
  });

  it("rejects caller-invented issue fields and unknown actions before invoking GitHub", async () => {
    const fixture = dependencies();
    await expect(
      fixture.service.execute(
        {
          ...issueRequest(),
          action: {
            ...issueRequest().action,
            findingClass: "iam-change",
            issueKey: "conformance.caller-invented",
          },
        },
        binding,
      ),
    ).rejects.toMatchObject({
      code: "action-mismatch",
    } satisfies Partial<GitHubConformanceActionError>);
    await expect(
      fixture.service.execute(
        {
          ...issueRequest(),
          action: {
            ...issueRequest().action,
            actionId: "action.issue.unknown",
          },
        },
        binding,
      ),
    ).rejects.toMatchObject({
      code: "action-not-known",
    } satisfies Partial<GitHubConformanceActionError>);
    expect(fixture.actions.issueCalls).toHaveLength(0);
  });

  it("records a reconciliation-PR request with no merge or remediation authority", async () => {
    const fixture = dependencies();
    const request = {
      action: {
        actionId: "action.reconcile.1",
        baseCommitSha: "a".repeat(40),
        extensionPreservationDigest: canonicalDigest("extension-preservation"),
        kind: "request-reconciliation-pr" as const,
        proposedArtifactDigest: canonicalDigest("reviewed-artifact"),
        repositorySnapshotDigest: canonicalDigest("repository-snapshot"),
      },
      binding,
      contractVersion: 1 as const,
      principalId,
    };
    fixture.knownActions.register({
      action: request.action,
      binding,
      sourceRecordDigest: canonicalDigest("proposal.reconciliation"),
    });
    const receipt = await fixture.service.execute(request, binding);

    expect(receipt).toMatchObject({
      actionKind: "request-reconciliation-pr",
      mergeAuthority: "none",
      providerState: "request-recorded",
      remediation: "none",
    });
    expect(fixture.actions.pullRequestCalls).toHaveLength(1);
    expect(fixture.actions.pullRequestCalls[0]).toMatchObject({
      mergeAuthority: "none",
      remediation: "none",
      summary: "A reviewed reconciliation proposal is available.",
    });
    expect(JSON.stringify(fixture.actions.pullRequestCalls[0])).not.toContain(
      "privateRepositoryContent",
    );
  });

  it("rejects unsorted evidence and extra secret, prompt, or repository-content fields", () => {
    expect(() =>
      gitHubConformanceActionRequestV1Schema.parse({
        ...issueRequest(),
        token: "not-accepted",
      }),
    ).toThrow();
    expect(() =>
      gitHubConformanceActionRequestV1Schema.parse({
        ...issueRequest(),
        binding: {
          ...binding,
          evidenceRecordIds: ["evidence.2", "evidence.1"],
        },
      }),
    ).toThrow(/sorted/u);
    expect(() =>
      gitHubConformanceActionRequestV1Schema.parse({
        ...issueRequest(),
        action: {
          ...issueRequest().action,
          rawPrompt: "not-accepted",
          privateRepositoryContent: "not-accepted",
        },
      }),
    ).toThrow();
  });
});
