export interface LatestSaveDrainOptions<Document, Head> {
  readonly currentHead: () => Head;
  readonly isBlocked: () => boolean;
  readonly save: (document: Document) => Promise<Head | null>;
}

export interface LatestSaveDrain<Document, Head> {
  clearPending(): void;
  flush(options: LatestSaveDrainOptions<Document, Head>): Promise<Head | null>;
  queue(document: Document): void;
}

class LatestSaveDrainCoordinator<Document, Head> implements LatestSaveDrain<
  Document,
  Head
> {
  #inFlight: Promise<Head | null> | null = null;
  #pending: Document | null = null;

  public clearPending(): void {
    this.#pending = null;
  }

  public queue(document: Document): void {
    this.#pending = document;
  }

  public flush(
    options: LatestSaveDrainOptions<Document, Head>,
  ): Promise<Head | null> {
    if (this.#inFlight !== null) {
      return this.#inFlight;
    }
    if (options.isBlocked()) {
      return Promise.resolve(null);
    }

    // Publish the promise before draining so a same-turn edit joins real work.
    const published = Promise.resolve().then(() => this.#drain(options));
    this.#inFlight = published;
    return published;
  }

  async #drain(
    options: LatestSaveDrainOptions<Document, Head>,
  ): Promise<Head | null> {
    try {
      let latestHead = options.currentHead();
      while (!options.isBlocked()) {
        const document = this.#pending;
        this.#pending = null;
        if (document === null) {
          return latestHead;
        }

        let saved: Head | null;
        try {
          saved = await options.save(document);
        } catch (error) {
          this.#pending ??= document;
          throw error;
        }
        if (saved === null) {
          this.#pending ??= document;
          return null;
        }
        latestHead = saved;
      }
      return null;
    } finally {
      // Release ownership before returning; callers cannot join a finished drain.
      this.#inFlight = null;
    }
  }
}

/**
 * Coalesces editor saves to the latest queued document while making every
 * caller join the same drain. A caller cannot observe an older successful head
 * while a newer queued document is being saved by that drain.
 */
export function createLatestSaveDrain<Document, Head>(): LatestSaveDrain<
  Document,
  Head
> {
  return new LatestSaveDrainCoordinator<Document, Head>();
}
