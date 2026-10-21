import { describe, expect, it } from "vitest";

import { mayRenderLocalMockIdentity } from "./mock-identity-boundary.js";

describe("local mock identity boundary", () => {
  it("is available only to an explicitly development build", () => {
    expect(mayRenderLocalMockIdentity(true)).toBe(true);
    expect(mayRenderLocalMockIdentity(false)).toBe(false);
  });
});
