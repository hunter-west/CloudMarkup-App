import { describe, expect, it } from "vitest";

import {
  getEditorHistoryShortcut,
  isEditorTextEntryTarget,
} from "./editor-history-shortcuts.js";

function shortcutEvent(
  overrides: Partial<KeyboardEvent> = {},
): Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "isComposing"
  | "key"
  | "metaKey"
  | "shiftKey"
  | "target"
> {
  return {
    altKey: false,
    ctrlKey: true,
    defaultPrevented: false,
    isComposing: false,
    key: "z",
    metaKey: false,
    shiftKey: false,
    target: document.body,
    ...overrides,
  };
}

describe("editor history shortcuts", () => {
  it("recognizes Windows/Linux and macOS undo and redo conventions", () => {
    expect(getEditorHistoryShortcut(shortcutEvent())).toBe("undo");
    expect(
      getEditorHistoryShortcut(
        shortcutEvent({ ctrlKey: false, metaKey: true }),
      ),
    ).toBe("undo");
    expect(getEditorHistoryShortcut(shortcutEvent({ shiftKey: true }))).toBe(
      "redo",
    );
    expect(getEditorHistoryShortcut(shortcutEvent({ key: "y" }))).toBe("redo");
  });

  it("does not intercept native text-entry controls", () => {
    const controls = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
    ];
    for (const control of controls) {
      expect(
        getEditorHistoryShortcut(shortcutEvent({ target: control })),
      ).toBeNull();
    }
  });

  it("does not intercept nested content-editable or ARIA text-entry targets", () => {
    const contentEditable = document.createElement("div");
    contentEditable.setAttribute("contenteditable", "true");
    const editableChild = document.createElement("span");
    const editableText = document.createTextNode("Draft name");
    editableChild.append(editableText);
    contentEditable.append(editableChild);
    expect(isEditorTextEntryTarget(editableChild)).toBe(true);
    expect(isEditorTextEntryTarget(editableText)).toBe(true);
    expect(
      getEditorHistoryShortcut(shortcutEvent({ target: editableChild })),
    ).toBeNull();
    expect(
      getEditorHistoryShortcut(shortcutEvent({ target: editableText })),
    ).toBeNull();

    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    const textboxChild = document.createElement("span");
    textbox.append(textboxChild);
    expect(isEditorTextEntryTarget(textboxChild)).toBe(true);
    expect(
      getEditorHistoryShortcut(shortcutEvent({ target: textboxChild })),
    ).toBeNull();
  });

  it("does not intercept composition, handled, or modified events", () => {
    expect(
      getEditorHistoryShortcut(shortcutEvent({ isComposing: true })),
    ).toBeNull();
    expect(
      getEditorHistoryShortcut(shortcutEvent({ defaultPrevented: true })),
    ).toBeNull();
    expect(
      getEditorHistoryShortcut(shortcutEvent({ altKey: true })),
    ).toBeNull();
    expect(
      getEditorHistoryShortcut(shortcutEvent({ ctrlKey: true, metaKey: true })),
    ).toBeNull();
  });
});
