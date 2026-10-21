import { describe, expect, it } from "vitest";
import {
  encodeMemoryWorkspaceHelperFailure,
  memoryWorkspaceHelperStages,
  parseMemoryWorkspaceHelperFailure,
  readMemoryApplicationBuildFailure,
  recordMemoryApplicationBuildFailure,
} from "./memory-workspace-diagnostics.js";
describe("closed memory workspace diagnostics", () => {
  it("retains no exception payload and rejects forged error fields", () => {
    const error = new Error("PRIVATE_SOURCE");
    Object.assign(error, {
      workspaceStage: "probe",
      helperStage: "core",
      stdout: "PRIVATE",
    });
    expect(readMemoryApplicationBuildFailure(error)).toBeUndefined();
    recordMemoryApplicationBuildFailure(error, { workspaceStage: "probe" });
    const diagnostic = readMemoryApplicationBuildFailure(error);
    expect(diagnostic).toEqual({ workspaceStage: "probe" });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE");
    expect(error.message).toBe("PRIVATE_SOURCE");
    expect(readMemoryApplicationBuildFailure("PRIVATE")).toBeUndefined();
  });
  it("merges only locally recorded stage metadata on the original exception", () => {
    const error = new TypeError("Memory helper failed.");
    recordMemoryApplicationBuildFailure(error, {
      helperStage: "workspace-mount",
    });
    recordMemoryApplicationBuildFailure(error, { workspaceStage: "probe" });
    expect(readMemoryApplicationBuildFailure(error)).toEqual({
      helperStage: "workspace-mount",
      workspaceStage: "probe",
    });
    expect(
      readMemoryApplicationBuildFailure(new Error(error.message)),
    ).toBeUndefined();
  });
  it("accepts only an entire fixed helper diagnostic line", () => {
    for (const stage of memoryWorkspaceHelperStages) {
      const encoded = encodeMemoryWorkspaceHelperFailure(stage);
      expect(parseMemoryWorkspaceHelperFailure(encoded)).toBe(stage);
      for (const text of [
        encoded + "PRIVATE",
        "PRIVATE" + encoded,
        encoded + encoded,
        encoded.trim(),
        encoded.replace(stage, "PRIVATE"),
      ])
        expect(parseMemoryWorkspaceHelperFailure(text)).toBeUndefined();
    }
  });
});
