// @user-owned CloudMarkup extension point; regeneration never overwrites this file.
export const extensionPointIds = [
  "application.notes.extensions"
] as const;

export interface CustomNotesBehavior {
  readonly implementation: "user-required";
}

export function customNotesBehavior(): CustomNotesBehavior {
  return { implementation: "user-required" };
}
