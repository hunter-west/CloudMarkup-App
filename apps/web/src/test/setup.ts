import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class TestResizeObserver implements ResizeObserver {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  disconnect(): void {
    return;
  }

  observe(target: Element): void {
    const measured = target.getBoundingClientRect();
    const width = measured.width > 0 ? measured.width : 1200;
    const height = measured.height > 0 ? measured.height : 800;
    const contentRect = {
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } satisfies DOMRectReadOnly;

    this.#callback(
      [
        {
          borderBoxSize: [],
          contentBoxSize: [],
          contentRect,
          devicePixelContentBoxSize: [],
          target,
        },
      ],
      this,
    );
  }

  unobserve(target: Element): void {
    void target;
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver,
  writable: true,
});

class TestDOMMatrixReadOnly {
  public readonly m22: number;

  public constructor(transform?: string) {
    const match = transform?.match(/^matrix\([^,]+,[^,]+,[^,]+,([^,]+)/u);
    this.m22 = Number(match?.[1] ?? 1);
  }
}

Object.defineProperty(window, "DOMMatrixReadOnly", {
  configurable: true,
  value: TestDOMMatrixReadOnly,
  writable: true,
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: () => undefined,
  writable: true,
});

afterEach(() => {
  cleanup();
});
