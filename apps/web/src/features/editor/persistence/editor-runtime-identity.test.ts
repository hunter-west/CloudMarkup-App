import { describe, expect, it } from "vitest";

import {
  createEditorCommandIdFactory,
  createEditorRuntimeIdentity,
} from "./editor-runtime-identity.js";

const PROVIDER_OPERATION_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

describe("editor runtime identity", () => {
  it("creates deterministic injectable writer and 32-character command identities", () => {
    const identity = createEditorRuntimeIdentity("abcd2345");
    const createId = createEditorCommandIdFactory(identity.commandIdPrefix);

    expect(identity).toEqual({
      commandIdPrefix: "operation_editor_abcd2345",
      sessionToken: "abcd2345",
      writerId: "writer_editor_abcd2345",
    });
    const first = createId();
    const second = createId();
    expect(first).toBe("operation_editor_abcd2345_000001");
    expect(second).toBe("operation_editor_abcd2345_000002");
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).toMatch(PROVIDER_OPERATION_ID_PATTERN);
    expect(second).toMatch(PROVIDER_OPERATION_ID_PATTERN);
  });

  it("generates an eight-character lowercase base32 browser-session token", () => {
    const identity = createEditorRuntimeIdentity();
    expect(identity.sessionToken).toMatch(/^[a-z2-7]{8}$/);
    expect(createEditorCommandIdFactory(identity.commandIdPrefix)()).toMatch(
      PROVIDER_OPERATION_ID_PATTERN,
    );
  });

  it("rejects malformed tokens and command prefixes", () => {
    expect(() => createEditorRuntimeIdentity("UPPER234")).toThrow(
      "lowercase base32",
    );
    expect(() => createEditorRuntimeIdentity("short23")).toThrow(
      "lowercase base32",
    );
    expect(() =>
      createEditorCommandIdFactory("operation_wrong_prefix"),
    ).toThrow("lowercase base32 session token");
  });

  it("fails closed before a sequence suffix can exceed six digits", () => {
    const createId = createEditorCommandIdFactory(
      "operation_editor_abcd2345",
      999_998,
    );
    const finalId = createId();
    expect(finalId).toBe("operation_editor_abcd2345_999999");
    expect(finalId).toHaveLength(32);
    expect(finalId).toMatch(PROVIDER_OPERATION_ID_PATTERN);
    expect(() => createId()).toThrow("exhausted");
  });
});
