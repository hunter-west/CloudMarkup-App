/** Synthetic HTTP assertions; never used by provider composition. */
export function httpText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.href;
  if (value instanceof Request) return value.url;
  throw new TypeError("Expected a synthetic HTTP URL or string body.");
}

export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {
    throw new Error("Synthetic promise not initialized.");
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
