import {
  completeGitlabLinkV1Schema,
  type CompleteGitlabLinkV1,
} from "@cloudmarkup/api-contract";

export type GitLabLinkCallback = Pick<CompleteGitlabLinkV1, "code" | "state">;
export const gitLabLinkCallbackSchema = completeGitlabLinkV1Schema.pick({
  code: true,
  state: true,
});

/** Capture once, then remove all callback parameters before rendering or requests. */
export function readAndRemoveGitLabLinkCallback():
  GitLabLinkCallback | undefined {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  if (url.pathname !== "/account/gitlab/callback") return undefined;
  window.history.replaceState(window.history.state, "", url.pathname);
  if (
    url.hash ||
    url.search.length > 8192 ||
    [...url.searchParams.keys()].length !== 2 ||
    url.searchParams.getAll("code").length !== 1 ||
    url.searchParams.getAll("state").length !== 1
  )
    return undefined;
  const result = gitLabLinkCallbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  return result.success ? result.data : undefined;
}
