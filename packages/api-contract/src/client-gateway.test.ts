import { describe, expect, it } from "vitest";
import {
  ApiGatewayError,
  ApiNetworkError,
  createCloudMarkupClient,
  createFetchTransport,
} from "./client.js";

describe("gateway response errors", () => {
  it("types a rejected fetch request without exposing transport exception text", async () => {
    const transport = createFetchTransport(() =>
      Promise.reject(new TypeError("secret transport detail")),
    );
    const failed = transport({
      method: "GET",
      headers: {},
      url: "/api/health",
    });
    await expect(failed).rejects.toBeInstanceOf(ApiNetworkError);
    await expect(failed).rejects.toMatchObject({
      message: "The API network request could not be completed.",
    });
  });
  it.each([502, 503, 504] as const)(
    "retains HTTP %i for a bounded caller retry without exposing upstream HTML",
    async (status) => {
      const client = createCloudMarkupClient({
        baseUrl: "/api",
        transport: () =>
          Promise.resolve({
            status,
            headers: new Headers(),
            text: () => Promise.resolve("<html>private upstream detail</html>"),
          }),
      });
      const failed = client.request("health.get", {});
      await expect(failed).rejects.toBeInstanceOf(ApiGatewayError);
      await expect(failed).rejects.toMatchObject({
        status,
        message: "The API gateway is temporarily unavailable.",
      });
    },
  );
  it("does not classify a malformed success response as a temporary gateway failure", async () => {
    const client = createCloudMarkupClient({
      baseUrl: "/api",
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: new Headers(),
          text: () => Promise.resolve("bad"),
        }),
    });
    const failed = client.request("health.get", {});
    await expect(failed).rejects.not.toBeInstanceOf(ApiGatewayError);
  });
});
