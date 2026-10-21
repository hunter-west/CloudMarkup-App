import type {
  GitlabProjectDiscoveryV1,
  GitlabProjectSelectionV1,
  UpdateGitlabProjectSelectionV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./ports.js";

export interface GitLabProjectsApplication {
  discover(
    principal: PrincipalContext,
    organizationId: string,
    connectionId: string,
    page: number,
  ): Promise<GitlabProjectDiscoveryV1>;
  selections(
    principal: PrincipalContext,
    organizationId: string,
    connectionId: string,
    limit: number,
    cursor?: string,
  ): Promise<{
    readonly items: readonly GitlabProjectSelectionV1[];
    readonly nextCursor?: string;
  }>;
  update(
    principal: PrincipalContext,
    organizationId: string,
    connectionId: string,
    projectId: number,
    input: UpdateGitlabProjectSelectionV1,
  ): Promise<GitlabProjectSelectionV1>;
}
