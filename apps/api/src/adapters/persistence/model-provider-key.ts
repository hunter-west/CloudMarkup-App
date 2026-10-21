/** Model adapter namespaces, not billing provider or legacy pricing identities.
 * Every historical lowercase hyphen key is retained. Dot-delimited segments
 * must be nonempty and start with a lowercase letter; maximum 64 characters. */
export const modelProviderKeyPattern =
  /^(?=.{1,64}$)[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u;
