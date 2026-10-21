import { GitLabProviderError } from "./gitlab-http.js";

/** Takes ownership of fresh buffers; metadata serialization cannot expose them. */
export class GitLabTokenMaterial {
  readonly #access: Uint8Array;
  readonly #refresh: Uint8Array;
  #consumed = false;
  constructor(access: Uint8Array, refresh: Uint8Array) {
    this.#access = access;
    this.#refresh = refresh;
  }
  async consume<T>(
    use: (tokens: {
      readonly accessToken: Uint8Array;
      readonly refreshToken: Uint8Array;
    }) => Promise<T>,
  ): Promise<T> {
    if (this.#consumed)
      throw new GitLabProviderError("not-sent", "invalid-input");
    this.#consumed = true;
    try {
      return await use({
        accessToken: this.#access,
        refreshToken: this.#refresh,
      });
    } finally {
      this.dispose();
    }
  }
  dispose(): void {
    this.#consumed = true;
    this.#access.fill(0);
    this.#refresh.fill(0);
  }
}
