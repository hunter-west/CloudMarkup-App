export type EditorHistoryShortcut = "redo" | "undo";

const TEXT_ENTRY_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  "[role='spinbutton']",
  ".nokey",
].join(",");

export function isEditorTextEntryTarget(target: EventTarget | null): boolean {
  const targetElement =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  return targetElement?.closest(TEXT_ENTRY_SELECTOR) !== null;
}

export function getEditorHistoryShortcut(
  event: Pick<
    KeyboardEvent,
    | "altKey"
    | "ctrlKey"
    | "defaultPrevented"
    | "isComposing"
    | "key"
    | "metaKey"
    | "shiftKey"
    | "target"
  >,
): EditorHistoryShortcut | null {
  const hasPlatformModifier = event.ctrlKey !== event.metaKey;
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    !hasPlatformModifier ||
    isEditorTextEntryTarget(event.target)
  ) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  if (key === "y" && !event.shiftKey) {
    return "redo";
  }
  return null;
}
