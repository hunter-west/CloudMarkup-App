export type BrowserAccessTokenSupplier = () =>
  string | undefined | Promise<string | undefined>;

function containsHeaderControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function accessTokenAuthorization(
  accessToken: (() => string | undefined) | undefined,
): string | undefined {
  const token = accessToken?.();
  if (token === undefined) return undefined;
  if (
    typeof token !== "string" ||
    token.length < 1 ||
    token.length > 16_384 ||
    containsHeaderControlOrSpace(token)
  ) {
    throw new TypeError("The browser access token is invalid.");
  }
  return `Bearer ${token}`;
}

export async function resolveAccessTokenAuthorization(
  accessToken: BrowserAccessTokenSupplier | undefined,
): Promise<string | undefined> {
  const token = await accessToken?.();
  return accessTokenAuthorization(() => token);
}
