import { matchRoute } from "../../routing/routes.js";

/** A return path is only a navigation selector. Its destination still performs
 * normal authenticated principal, organization and project authorization. */
function hasUnsafePathCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127 || code === 92) return true;
  }
  return false;
}

export function checkedSignInReturnPath(
  value: string | null,
): string | undefined {
  if (
    value === null ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasUnsafePathCharacter(value)
  )
    return undefined;
  const url = new URL(value, "https://cloudmarkup.invalid");
  if (
    url.origin !== "https://cloudmarkup.invalid" ||
    !/^\/(?:organizations|settings|invitations)(?:\/|$)/u.test(url.pathname) ||
    matchRoute(url.pathname).id === "not-found"
  )
    return undefined;
  return url.pathname + url.search + url.hash;
}
export function signInPathForReturn(value: string): string {
  const path = checkedSignInReturnPath(value);
  return path === undefined
    ? "/sign-in"
    : "/sign-in?" + new URLSearchParams({ returnTo: path }).toString();
}
export function signInReturnPathFromSearch(search: string): string | undefined {
  const values = new URLSearchParams(search).getAll("returnTo");
  return values.length === 1
    ? checkedSignInReturnPath(values[0] ?? null)
    : undefined;
}
