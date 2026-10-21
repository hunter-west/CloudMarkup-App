import { createContext, useContext } from "react";

import type { Notifications } from "./notification.js";

export const NotificationsContext = createContext<Notifications | null>(null);

export function useNotifications(): Notifications {
  const notifications = useContext(NotificationsContext);

  if (notifications === null) {
    throw new Error(
      "useNotifications must be used within a NotificationProvider.",
    );
  }

  return notifications;
}
