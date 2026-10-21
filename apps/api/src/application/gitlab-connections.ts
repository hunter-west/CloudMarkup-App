import type {
  CompleteGitlabLinkV1,
  GitlabConnectionV1,
  GitlabLinkIntentV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./ports.js";

/** All workspace/actor authority comes from current verified application context. */
export interface GitLabConnectionsApplication {
  start(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<{ readonly intent: GitlabLinkIntentV1; readonly cookie: string }>;
  complete(
    principal: PrincipalContext,
    organizationId: string,
    input: CompleteGitlabLinkV1,
    cookie: string,
  ): Promise<GitlabConnectionV1>;
  list(
    principal: PrincipalContext,
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<{
    readonly items: readonly GitlabConnectionV1[];
    readonly nextCursor?: string;
  }>;
  get(
    principal: PrincipalContext,
    organizationId: string,
    connectionId: string,
  ): Promise<GitlabConnectionV1>;
  disconnect(
    principal: PrincipalContext,
    organizationId: string,
    connectionId: string,
  ): Promise<GitlabConnectionV1>;
}
