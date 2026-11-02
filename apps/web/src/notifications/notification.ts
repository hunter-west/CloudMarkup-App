export type NotificationKind = "info" | "success" | "warning" | "error";

export interface NotificationDraft {
  readonly title: string;
  readonly message?: string;
  readonly kind?: NotificationKind;
  readonly toast?: boolean;
}

export interface NotificationItem {
  readonly id: string;
  readonly title: string;
  readonly message?: string;
  readonly kind: NotificationKind;
  readonly toast: boolean;
  readonly dismissed: boolean;
  readonly seen: boolean;
  readonly read: boolean;
}

export interface Notifications {
  readonly history: readonly NotificationItem[];
  readonly activeToasts: readonly NotificationItem[];
  readonly unseenCount: number;
  readonly unreadCount: number;
  readonly addNotification: (draft: NotificationDraft) => string;
  readonly dismissNotification: (id: string) => void;
  readonly markNotificationsSeen: (ids: readonly string[]) => void;
  readonly markNotificationsRead: (ids: readonly string[]) => void;
}

export const MAX_NOTIFICATION_TITLE_LENGTH = 120;
export const MAX_NOTIFICATION_MESSAGE_LENGTH = 320;
export const MAX_NOTIFICATION_HISTORY_ITEMS = 100;

function isUnsafeDisplayCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

export function toSafeNotificationText(
  value: string,
  maximumLength: number,
): string {
  const normalized = Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && isUnsafeDisplayCodePoint(codePoint)
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();

  return Array.from(normalized).slice(0, maximumLength).join("");
}
