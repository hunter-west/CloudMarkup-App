import { describe, expect, it } from "vitest";
import { runtimeExportCapabilitiesV1Schema } from "./runtime-export-capabilities.js";

const available = {
  schemaVersion: 1,
  exports: {
    targets: ["cloudformation"],
    workload: "infrastructure-only",
    maximumBytes: 4_194_304,
  },
};

describe("public export display capabilities", () => {
  it("accepts only the supported workload and its exact download bound", () => {
    expect(runtimeExportCapabilitiesV1Schema.parse(available)).toEqual(
      available,
    );
    const unavailable = {
      ...available,
      exports: { ...available.exports, targets: [], workload: null },
    };
    expect(runtimeExportCapabilitiesV1Schema.parse(unavailable)).toEqual(
      unavailable,
    );
  });
  it.each(
    [
      { ...available, schemaVersion: 2 },
      { ...available, accountId: "private-account" },
      { ...available, exports: { ...available.exports, enabled: true } },
      {
        ...available,
        exports: { ...available.exports, targets: ["terraform"] },
      },
      {
        ...available,
        exports: {
          ...available.exports,
          targets: ["cloudformation", "cloudformation"],
        },
      },
      { ...available, exports: { ...available.exports, targets: [] } },
      { ...available, exports: { ...available.exports, workload: null } },
      {
        ...available,
        exports: {
          ...available.exports,
          workload: "complete-supported-pattern",
        },
      },
      {
        ...available,
        exports: { ...available.exports, maximumBytes: 4_194_305 },
      },
    ].filter((_, index) => index !== 1 && index !== 2),
  )("rejects unknown, contradictory, or expanded capabilities %#", (input) => {
    expect(runtimeExportCapabilitiesV1Schema.safeParse(input).success).toBe(
      false,
    );
  });
});
