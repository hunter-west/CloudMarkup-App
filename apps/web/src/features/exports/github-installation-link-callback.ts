import {
  completeGithubAppInstallationLinkV1Schema,
  type CompleteGithubAppInstallationLinkV1,
} from "@cloudmarkup/api-contract";

/** Capture once, then remove proof before requests, rendering, or navigation. */
export function readAndRemoveGitHubInstallationLinkCallback(): {
  readonly callback?: CompleteGithubAppInstallationLinkV1;
  readonly present: boolean;
} {
  if (typeof window === "undefined") return { present: false };
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const keys = ["github_link_intent", "github_link_receipt"] as const;
  const hasFragment = keys.some((key) => fragment.has(key));
  const hasQuery = keys.some((key) => url.searchParams.has(key));
  if (!hasFragment && !hasQuery) return { present: false };
  const values = hasFragment ? fragment : url.searchParams;
  const intents = values.getAll(keys[0]);
  const receipts = values.getAll(keys[1]);
  for (const key of keys) {
    fragment.delete(key);
    url.searchParams.delete(key);
  }
  if (hasFragment) url.hash = fragment.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  if (
    (hasFragment && hasQuery) ||
    intents.length !== 1 ||
    receipts.length !== 1
  )
    return { present: true };
  const parsed = completeGithubAppInstallationLinkV1Schema.safeParse({
    callbackReceipt: receipts[0],
    contractVersion: 1,
    intentId: intents[0],
  });
  return parsed.success
    ? { callback: parsed.data, present: true }
    : { present: true };
}
