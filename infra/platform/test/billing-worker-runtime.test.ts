import { afterEach, describe, expect, it, vi } from "vitest";
const worker = vi.hoisted(() => vi.fn());
vi.mock("@cloudmarkup/api/billing", () => ({ billingWorkerHandler: worker }));
import { handler } from "../runtime/billing-worker.js";

afterEach(() => {
  vi.restoreAllMocks();
  worker.mockReset();
});
describe("billing consumer runtime observability", () => {
  it("reports partial-batch retries without any request or provider data", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const event = { sensitive: "never-log-this-body" };
    const response = {
      batchItemFailures: [{ itemIdentifier: "never-log-this-identifier" }],
    };
    worker.mockResolvedValue(response);
    expect(await handler(event)).toBe(response);
    expect(worker).toHaveBeenCalledWith(event);
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      '{"component":"billing-worker","outcome":"batch-retry"}',
    );
  });
  it("leaves successful deliveries quiet", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    worker.mockResolvedValue({ batchItemFailures: [] });
    await expect(handler({})).resolves.toEqual({ batchItemFailures: [] });
    expect(warning).not.toHaveBeenCalled();
  });
  it("preserves invocation failures without re-logging sensitive error details", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const failure = new Error("provider error details");
    worker.mockRejectedValue(failure);
    await expect(handler({})).rejects.toBe(failure);
    expect(warning).not.toHaveBeenCalled();
  });
});
