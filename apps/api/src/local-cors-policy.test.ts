import { describe, expect, it } from "vitest";

import {
  LOCAL_CORS_EXPOSED_HEADERS_V1,
  LOCAL_CORS_EXPOSED_HEADERS_VALUE_V1,
} from "./local-cors-policy.js";

describe("local API CORS response policy", () => {
  it("exposes every security and integrity header verified by browser downloads", () => {
    expect(LOCAL_CORS_EXPOSED_HEADERS_V1).toEqual(
      expect.arrayContaining([
        "Content-Disposition",
        "Content-Security-Policy",
        "Referrer-Policy",
        "X-CloudMarkup-Content-Sha256",
        "X-Content-Type-Options",
      ]),
    );
    expect(LOCAL_CORS_EXPOSED_HEADERS_VALUE_V1).toBe(
      LOCAL_CORS_EXPOSED_HEADERS_V1.join(", "),
    );
  });
});
