import { generateSolutionExport } from "@cloudmarkup/solution-export";
import { projectGoCompilationResultToSolutionExportInfrastructure } from "@cloudmarkup/solution-export-workflow";
import {
  TEST_RENDERER,
  TEST_TARGET_SETTINGS,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";
import { describe, expect, it } from "vitest";

import {
  FakeGitHubInstallationLinkCallbackVerifier,
  InMemoryApprovedSolutionPackageRepository,
  InMemoryGitHubExportStore,
  RecordingGitHubExportAuditSink,
  RecordingGitHubExportProgressSink,
} from "./fakes.js";
import { GitHubRestAppAdapter } from "./github-rest-adapter.js";
import { GitHubRepositoryExportService } from "./service.js";
import type {
  GitHubAppConfiguration,
  SecretConfigurationResolver,
} from "./ports.js";

const LIVE_ACKNOWLEDGEMENT = "dedicated-test-installation-and-repository";
const liveEnabled = process.env["CLOUDMARKUP_GITHUB_LIVE_TEST"] === "1";
const liveWriteEnabled =
  liveEnabled && process.env["CLOUDMARKUP_GITHUB_LIVE_WRITE_TEST"] === "1";

function requireLiveValue(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`The opt-in live test requires ${name}.`);
  }
  return value;
}

class LivePrivateKeyResolver implements SecretConfigurationResolver {
  resolveSecret(reference: string): Promise<Uint8Array> {
    if (reference !== "env://CLOUDMARKUP_GITHUB_LIVE_PRIVATE_KEY") {
      return Promise.reject(new Error("Unexpected live secret reference."));
    }
    return Promise.resolve(
      new TextEncoder().encode(
        requireLiveValue("CLOUDMARKUP_GITHUB_LIVE_PRIVATE_KEY"),
      ),
    );
  }
}

describe.skipIf(!liveEnabled)("GitHub App dedicated live smoke", () => {
  it("discovers only the explicitly named dedicated repository with read permissions", async () => {
    expect(requireLiveValue("CLOUDMARKUP_GITHUB_LIVE_ACK")).toBe(
      LIVE_ACKNOWLEDGEMENT,
    );
    const installationId = Number(
      requireLiveValue("CLOUDMARKUP_GITHUB_LIVE_INSTALLATION_ID"),
    );
    expect(Number.isSafeInteger(installationId) && installationId > 0).toBe(
      true,
    );
    const expectedOwner = requireLiveValue(
      "CLOUDMARKUP_GITHUB_LIVE_REPOSITORY_OWNER",
    );
    const expectedName = requireLiveValue(
      "CLOUDMARKUP_GITHUB_LIVE_REPOSITORY_NAME",
    );
    const configuration: GitHubAppConfiguration = {
      apiBaseUrl: "https://api.github.com",
      apiVersion: "2022-11-28",
      appId: requireLiveValue("CLOUDMARKUP_GITHUB_LIVE_APP_ID"),
      privateKeySecretReference: "env://CLOUDMARKUP_GITHUB_LIVE_PRIVATE_KEY",
      userAgent: "cloudmarkup-dedicated-live-test",
      webhookSecretReference: "unused://read-only-live-smoke",
    };
    const adapter = new GitHubRestAppAdapter({
      configuration,
      secrets: new LivePrivateKeyResolver(),
    });

    const installation = await adapter.inspectInstallation(installationId);
    expect(installation.installationId).toBe(installationId);
    const discovered = await adapter.withInstallationSession(
      {
        installationId,
        permissions: {
          contents: "read",
          metadata: "read",
          pullRequests: "none",
          workflows: "none",
        },
      },
      (session) => session.listRepositories(),
    );
    const repository = discovered.find(
      ({ name, owner }) => name === expectedName && owner === expectedOwner,
    );
    expect(repository).toBeDefined();
    if (repository === undefined) return;
    const branches = await adapter.withInstallationSession(
      {
        installationId,
        permissions: {
          contents: "read",
          metadata: "read",
          pullRequests: "none",
          workflows: "none",
        },
        repositoryIds: [repository.repositoryId],
      },
      (session) => session.listBranches(repository),
    );

    expect(branches.some(({ name }) => name === repository.defaultBranch)).toBe(
      true,
    );
    expect(JSON.stringify({ installation, repository, branches })).not.toMatch(
      /token|private[_-]?key|credential/i,
    );
  });
});

describe.skipIf(!liveWriteEnabled)(
  "GitHub App dedicated live package export",
  () => {
    it("uses test-only callback proof to create one feature branch and pull request without workflows, merge, or deployment", async () => {
      expect(requireLiveValue("CLOUDMARKUP_GITHUB_LIVE_ACK")).toBe(
        LIVE_ACKNOWLEDGEMENT,
      );
      const installationId = Number(
        requireLiveValue("CLOUDMARKUP_GITHUB_LIVE_INSTALLATION_ID"),
      );
      const expectedOwner = requireLiveValue(
        "CLOUDMARKUP_GITHUB_LIVE_REPOSITORY_OWNER",
      );
      const expectedName = requireLiveValue(
        "CLOUDMARKUP_GITHUB_LIVE_REPOSITORY_NAME",
      );
      const baseBranch = requireLiveValue(
        "CLOUDMARKUP_GITHUB_LIVE_BASE_BRANCH",
      );
      const featureBranch = requireLiveValue(
        "CLOUDMARKUP_GITHUB_LIVE_FEATURE_BRANCH",
      );
      const destinationFolder = requireLiveValue(
        "CLOUDMARKUP_GITHUB_LIVE_DESTINATION_FOLDER",
      );
      expect(featureBranch.startsWith("cloudmarkup-live/")).toBe(true);
      expect(destinationFolder.startsWith("cloudmarkup-live/")).toBe(true);
      const fixture = workflowFixture("infrastructure-only");
      const generated = generateSolutionExport({
        architectureDocument: fixture.generationRequest.architectureDocument,
        contractVersion: 1,
        existingFiles: [],
        infrastructure:
          projectGoCompilationResultToSolutionExportInfrastructure(
            fixture.compilation,
          ),
        solutionRevision: fixture.generationRequest.solutionRevision,
        supplementalFiles: [],
        target: {
          exportName: "CloudMarkup GitHub Live Test",
          limits: TEST_TARGET_SETTINGS.limits,
          policyPacks: TEST_TARGET_SETTINGS.policyPacks,
          renderer: TEST_RENDERER,
          target: TEST_TARGET_SETTINGS.target,
        },
      });
      expect(generated.state).toBe("ready");
      if (generated.state !== "ready") return;
      const artifacts = new InMemoryApprovedSolutionPackageRepository();
      artifacts.add({
        artifact: generated.artifact,
        artifactId: "artifact.github-live",
        organizationId: "organization.github-live",
        projectId: "project.github-live",
      });
      let sequence = 0;
      const store = new InMemoryGitHubExportStore();
      // This manually gated export test validates service/store wiring against a
      // dedicated live installation. Its fake receipt is not production callback proof.
      const testOnlyCallbackVerifier =
        new FakeGitHubInstallationLinkCallbackVerifier();
      const service = new GitHubRepositoryExportService({
        artifactRepository: artifacts,
        audit: new RecordingGitHubExportAuditSink(),
        github: new GitHubRestAppAdapter({
          configuration: {
            apiBaseUrl: "https://api.github.com",
            apiVersion: "2022-11-28",
            appId: requireLiveValue("CLOUDMARKUP_GITHUB_LIVE_APP_ID"),
            privateKeySecretReference:
              "env://CLOUDMARKUP_GITHUB_LIVE_PRIVATE_KEY",
            userAgent: "cloudmarkup-dedicated-live-write-test",
            webhookSecretReference: "unused://live-write-test",
          },
          secrets: new LivePrivateKeyResolver(),
        }),
        idFactory: (kind) => `${kind}.live.${String(++sequence)}`,
        installationLinkCallbackVerifier: testOnlyCallbackVerifier,
        installationSetupUrl:
          "https://github.com/apps/cloudmarkup-dedicated-live-test/installations/new",
        progress: new RecordingGitHubExportProgressSink(),
        store,
      });
      const linkIntent = await service.createInstallationLinkIntent({
        correlationId: "correlation.github-live.link-intent",
        organizationId: "organization.github-live",
        principalId: "principal.github-live",
      });
      const testOnlyCallbackReceipt = `live-test-receipt.${linkIntent.intentId}`;
      testOnlyCallbackVerifier.addReceipt(testOnlyCallbackReceipt, {
        installationId,
        setupAction: "install",
        state: linkIntent.state,
      });
      const installation = await service.completeInstallationLink({
        callbackReceipt: testOnlyCallbackReceipt,
        correlationId: "correlation.github-live.link-completion",
        intentId: linkIntent.intentId,
        organizationId: "organization.github-live",
        principalId: "principal.github-live",
      });
      const repositories = await service.discoverRepositories({
        correlationId: "correlation.github-live.discover",
        integrationId: installation.integrationId,
        organizationId: "organization.github-live",
        principalId: "principal.github-live",
      });
      const repository = repositories.find(
        ({ name, owner }) => name === expectedName && owner === expectedOwner,
      );
      expect(repository).toBeDefined();
      if (repository === undefined) return;
      const preview = await service.createPreview({
        artifactId: "artifact.github-live",
        baseBranch,
        correlationId: "correlation.github-live.preview",
        destinationFolder,
        featureBranch,
        includeWorkflows: false,
        integrationId: installation.integrationId,
        organizationId: "organization.github-live",
        principalId: "principal.github-live",
        projectId: "project.github-live",
        repositoryId: repository.repositoryId,
      });
      expect(preview.ready).toBe(true);
      expect(preview.workflowFiles).toEqual([]);

      const receipt = await service.execute({
        confirmedWorkflowFiles: [],
        correlationId: "correlation.github-live.execute",
        idempotencyKey: featureBranch,
        organizationId: "organization.github-live",
        previewDigest: preview.previewDigest,
        previewId: preview.previewId,
        principalId: "principal.github-live",
        projectId: "project.github-live",
      });

      expect(receipt.branch).toBe(featureBranch);
      expect(receipt.pullRequestUrl).toContain(
        `github.com/${expectedOwner}/${expectedName}/pull/`,
      );
    });
  },
);
