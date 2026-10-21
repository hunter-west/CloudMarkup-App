export interface ImmutableAttemptCoordinator<Attempt extends object> {
  abandon(): boolean;
  complete(attempt: Attempt): boolean;
  prepare(
    createAttempt: () => Promise<Attempt | null>,
  ): Promise<Attempt | null>;
}

class DefaultImmutableAttemptCoordinator<
  Attempt extends object,
> implements ImmutableAttemptCoordinator<Attempt> {
  #attempt: Attempt | null = null;
  #preparing: Promise<Attempt | null> | null = null;

  public abandon(): boolean {
    if (this.#preparing !== null) return false;
    this.#attempt = null;
    return true;
  }

  public complete(attempt: Attempt): boolean {
    if (this.#attempt !== attempt) return false;
    this.#attempt = null;
    return true;
  }

  public prepare(
    createAttempt: () => Promise<Attempt | null>,
  ): Promise<Attempt | null> {
    if (this.#attempt !== null) return Promise.resolve(this.#attempt);
    if (this.#preparing !== null) return this.#preparing;

    const published = createAttempt()
      .then((attempt) => {
        if (attempt !== null && this.#attempt === null) {
          this.#attempt = attempt;
        }
        return this.#attempt;
      })
      .finally(() => {
        this.#preparing = null;
      });
    this.#preparing = published;
    return published;
  }
}

/**
 * Retains one exact mutation attempt across transport/application failures.
 * Callers explicitly complete a confirmed result or abandon the attempt before
 * creating a request with newer inputs.
 */
export function createImmutableAttemptCoordinator<
  Attempt extends object,
>(): ImmutableAttemptCoordinator<Attempt> {
  return new DefaultImmutableAttemptCoordinator<Attempt>();
}
