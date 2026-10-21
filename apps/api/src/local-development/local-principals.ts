import { LocalDevelopmentPrincipalResolver } from "../adapters/identity/local-development-principal-resolver.js";

export const LOCAL_IDENTITY_TOKENS = [
  "local-owner",
  "local-team-owner",
  "local-team-administrator",
  "local-team-editor",
  "local-team-viewer",
] as const;

export const LOCAL_ORGANIZATIONS_BY_PRINCIPAL: Readonly<
  Record<string, string>
> = {
  principal_local_owner: "org_local",
  principal_local_team_administrator: "org_local_team",
  principal_local_team_editor: "org_local_team",
  principal_local_team_owner: "org_local_team",
  principal_local_team_viewer: "org_local_team",
};
export const LOCAL_PRINCIPAL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  principal_local_owner: "Local CloudMarkup Owner",
  principal_local_team_administrator: "Local Team Administrator",
  principal_local_team_editor: "Local Team Editor",
  principal_local_team_owner: "Local Team Owner",
  principal_local_team_viewer: "Local Team Viewer",
};
const principalIdByToken: Readonly<
  Record<(typeof LOCAL_IDENTITY_TOKENS)[number], string>
> = {
  "local-owner": "principal_local_owner",
  "local-team-administrator": "principal_local_team_administrator",
  "local-team-editor": "principal_local_team_editor",
  "local-team-owner": "principal_local_team_owner",
  "local-team-viewer": "principal_local_team_viewer",
};

export function createLocalPrincipalResolver(
  now: Date = new Date(),
): LocalDevelopmentPrincipalResolver {
  const authenticatedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + 24 * 60 * 60 * 1_000,
  ).toISOString();
  return new LocalDevelopmentPrincipalResolver({
    enabled: true,
    principalsByToken: Object.fromEntries(
      LOCAL_IDENTITY_TOKENS.map((token) => [
        token,
        {
          authenticatedAt,
          expiresAt,
          principalId: principalIdByToken[token],
          sessionId: `session_${token}`,
        },
      ]),
    ),
    runtimeEnvironment: "local",
  });
}
