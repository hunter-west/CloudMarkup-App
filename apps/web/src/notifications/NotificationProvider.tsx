import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  MAX_NOTIFICATION_HISTORY_ITEMS,
  MAX_NOTIFICATION_MESSAGE_LENGTH,
  MAX_NOTIFICATION_TITLE_LENGTH,
  toSafeNotificationText,
} from "./notification.js";
import type {
  NotificationDraft,
  NotificationItem,
  Notifications,
} from "./notification.js";
import { NotificationsContext } from "./notification-context.js";

export interface NotificationProviderProps {
  readonly children: ReactNode;
}

export function NotificationProvider({ children }: NotificationProviderProps) {
  const [history, setHistory] = useState<readonly NotificationItem[]>([]);
  const nextIdentifier = useRef(1);

  const addNotification = useCallback((draft: NotificationDraft): string => {
    const id = `local-notification-${String(nextIdentifier.current)}`;
    nextIdentifier.current += 1;

    const title =
      toSafeNotificationText(draft.title, MAX_NOTIFICATION_TITLE_LENGTH) ||
      "Update";
    const message =
      draft.message === undefined
        ? ""
        : toSafeNotificationText(
            draft.message,
            MAX_NOTIFICATION_MESSAGE_LENGTH,
          );
    const item: NotificationItem = {
      id,
      title,
      kind: draft.kind ?? "info",
      toast: draft.toast ?? true,
      dismissed: false,
      seen: false,
      read: false,
      ...(message === "" ? {} : { message }),
    };

    setHistory((currentHistory) =>
      [item, ...currentHistory].slice(0, MAX_NOTIFICATION_HISTORY_ITEMS),
    );

    return id;
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setHistory((currentHistory) => {
      const item = currentHistory.find(
        (notification) => notification.id === id,
      );

      if (item === undefined || item.dismissed) {
        return currentHistory;
      }

      return currentHistory.map((notification) =>
        notification.id === id
          ? { ...notification, dismissed: true }
          : notification,
      );
    });
  }, []);

  const markNotificationsSeen = useCallback((ids: readonly string[]) => {
    const seenIds = new Set(ids);
    setHistory((currentHistory) => {
      if (!currentHistory.some((item) => !item.seen && seenIds.has(item.id)))
        return currentHistory;
      return currentHistory.map((item) =>
        seenIds.has(item.id) ? { ...item, seen: true } : item,
      );
    });
  }, []);

  const markNotificationsRead = useCallback((ids: readonly string[]) => {
    const readIds = new Set(ids);
    setHistory((currentHistory) => {
      if (!currentHistory.some((item) => !item.read && readIds.has(item.id)))
        return currentHistory;
      return currentHistory.map((item) =>
        readIds.has(item.id) ? { ...item, seen: true, read: true } : item,
      );
    });
  }, []);

  const activeToasts = useMemo(
    () =>
      history.filter(
        (notification) => notification.toast && !notification.dismissed,
      ),
    [history],
  );

  const value = useMemo<Notifications>(
    () => ({
      history,
      activeToasts,
      unseenCount: history.filter((item) => !item.seen).length,
      unreadCount: history.filter((item) => !item.read).length,
      addNotification,
      dismissNotification,
      markNotificationsSeen,
      markNotificationsRead,
    }),
    [
      activeToasts,
      addNotification,
      dismissNotification,
      history,
      markNotificationsRead,
      markNotificationsSeen,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}
