import { describe, expect, it } from "vitest";
import {
  gitlabProjectV1Schema,
  gitlabProjectDiscoveryV1Schema,
  gitlabProjectSelectionV1Schema,
  gitlabProjectSelectionPathV1Schema,
  updateGitlabProjectSelectionV1Schema,
} from "./gitlab-projects.js";
const binding = {
  contractVersion: 1,
  organizationId: "org_example",
  principalId: "principal_actor",
  connectionId: "gitlab_" + "1".repeat(32),
};
const project = {
  projectId: 42,
  pathWithNamespace: "group/project",
  defaultBranch: "main",
  url: "https://gitlab.com/group/project",
  eligibility: "eligible",
};
describe("GitLab selected project contracts", () => {
  it("accepts credential-free provider discovery and explicit versioned selection", () => {
    expect(
      gitlabProjectDiscoveryV1Schema.parse({
        ...binding,
        projects: [project],
        nextPage: null,
      }).projects,
    ).toHaveLength(1);
    expect(
      gitlabProjectSelectionV1Schema.parse({
        ...binding,
        projectId: 42,
        version: 1,
        enabled: true,
      }).enabled,
    ).toBe(true);
    expect(
      updateGitlabProjectSelectionV1Schema.parse({
        contractVersion: 1,
        expectedVersion: 0,
        enabled: true,
      }).expectedVersion,
    ).toBe(0);
  });
  it.each([
    { url: "https://evil.example/group/project" },
    { url: "https://gitlab.com/group/other" },
    {
      pathWithNamespace: "group/../project",
      url: "https://gitlab.com/group/../project",
    },
    { defaultBranch: null },
    { projectId: Number.MAX_SAFE_INTEGER + 1 },
    { projectId: 0 },
    { accessToken: "secret" },
  ])("rejects unsafe project metadata %#", (change) => {
    expect(
      gitlabProjectV1Schema.safeParse({ ...project, ...change }).success,
    ).toBe(false);
  });
  it.each([
    [project, project],
    [{ ...project, projectId: 43 }, project],
  ])("rejects duplicate or unordered discovery %#", (projects) => {
    expect(
      gitlabProjectDiscoveryV1Schema.safeParse({
        ...binding,
        projects,
        nextPage: null,
      }).success,
    ).toBe(false);
  });
  it.each(
    ["0", "01", "42.1", "9007199254740992", "group/project"].filter(
      (_, index) => index !== 2 && index !== 4,
    ),
  )("rejects ambiguous project selector %s", (projectId) => {
    expect(
      gitlabProjectSelectionPathV1Schema.safeParse({
        organizationId: binding.organizationId,
        connectionId: binding.connectionId,
        projectId,
      }).success,
    ).toBe(false);
  });
  it.each(
    [
      { expectedVersion: -1 },
      { expectedVersion: 1.1 },
      { expectedVersion: Number.MAX_SAFE_INTEGER },
      { enabled: "true" },
      { providerAccessLevel: 50 },
      { principalId: "principal_other" },
    ].filter((_, index) => index !== 4),
  )("rejects untrusted selection fields %#", (change) => {
    expect(
      updateGitlabProjectSelectionV1Schema.safeParse({
        contractVersion: 1,
        expectedVersion: 0,
        enabled: true,
        ...change,
      }).success,
    ).toBe(false);
  });
});
