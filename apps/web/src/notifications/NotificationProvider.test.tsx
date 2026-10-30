import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationProvider, useNotifications } from "./index.js";

function NotificationProbe() {
  const {
    activeToasts,
    addNotification,
    dismissNotification,
    history,
    markNotificationsRead,
    markNotificationsSeen,
    unreadCount,
    unseenCount,
  } = useNotifications();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          addNotification({
            title: `Saved\u0000 ${"x".repeat(200)}`,
            message: "The persistent activity record remains available.",
            kind: "success",
          });
        }}
      >
        Add saved notification
      </button>
      <button
        type="button"
        onClick={() => {
          addNotification({
            title: "History only",
            toast: false,
          });
        }}
      >
        Add history notification
      </button>
      <button
        type="button"
        onClick={() => {
          markNotificationsSeen(history.map((item) => item.id));
        }}
      >
        Open account
      </button>
      <button
        type="button"
        onClick={() => {
          markNotificationsRead(history.map((item) => item.id));
        }}
      >
        Open notifications
      </button>
      <button
        type="button"
        onClick={() => {
          const displayedIds = history.map((item) => item.id);
          addNotification({ title: "New required action", kind: "error" });
          markNotificationsRead(displayedIds);
        }}
      >
        Read displayed and receive another
      </button>
      <output data-testid="active-toast-count">{activeToasts.length}</output>
      <output data-testid="unseen-count">{unseenCount}</output>
      <output data-testid="unread-count">{unreadCount}</output>
      <ul aria-label="Notification history">
        {history.map((notification) => (
          <li key={notification.id}>
            <span>{notification.title}</span>
            <span>{notification.kind}</span>
            <span>{notification.dismissed ? "Dismissed" : "Active"}</span>
            <span>{notification.seen ? "Seen" : "New"}</span>
            <span>{notification.read ? "Read" : "Unread"}</span>
            {!notification.dismissed && notification.toast ? (
              <button
                type="button"
                onClick={() => {
                  dismissNotification(notification.id);
                }}
              >
                Dismiss {notification.title}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

describe("NotificationProvider", () => {
  it("dismisses a toast without deleting its history record", () => {
    render(
      <NotificationProvider>
        <NotificationProbe />
      </NotificationProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add saved notification" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Dismiss Saved/iu }));

    const history = screen.getByRole("list", {
      name: "Notification history",
    });

    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
    expect(within(history).getByText("Dismissed")).toBeVisible();
    expect(screen.getByTestId("active-toast-count")).toHaveTextContent("0");
    expect(screen.getByTestId("unseen-count")).toHaveTextContent("1");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Open account" }));
    expect(screen.getByTestId("unseen-count")).toHaveTextContent("0");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
    expect(within(history).getByText("Read")).toBeVisible();
    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
  });

  it("leaves concurrent arrivals unread and keeps tab sessions independent", () => {
    const session = render(
      <NotificationProvider>
        <NotificationProbe />
      </NotificationProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add history notification" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Read displayed and receive another",
      }),
    );
    const history = screen.getByRole("list", { name: "Notification history" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId("unseen-count")).toHaveTextContent("1");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
    expect(screen.getByTestId("active-toast-count")).toHaveTextContent("1");
    const requiredAction = within(history).getAllByRole("listitem")[0];
    if (requiredAction === undefined)
      throw new Error("Missing required action");
    expect(within(requiredAction).getByText("Unread")).toBeVisible();

    session.rerender(
      <NotificationProvider>
        <NotificationProbe key="remounted-view" />
      </NotificationProvider>,
    );
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
    expect(screen.getByText("New required action")).toBeVisible();
    expect(screen.getByTestId("active-toast-count")).toHaveTextContent("1");

    const otherSession = render(
      <NotificationProvider>
        <NotificationProbe />
      </NotificationProvider>,
    );
    expect(
      within(otherSession.container).getByTestId("unread-count"),
    ).toHaveTextContent("0");
    expect(
      within(otherSession.container).queryAllByRole("listitem"),
    ).toHaveLength(0);
    expect(within(session.container).getAllByRole("listitem")).toHaveLength(2);
    session.unmount();
    otherSession.unmount();
    render(
      <NotificationProvider>
        <NotificationProbe />
      </NotificationProvider>,
    );
    expect(screen.getByTestId("unseen-count")).toHaveTextContent("0");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("can retain a history item without presenting it as a toast", () => {
    render(
      <NotificationProvider>
        <NotificationProbe />
      </NotificationProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add history notification" }),
    );

    expect(
      within(
        screen.getByRole("list", { name: "Notification history" }),
      ).getByText("History only"),
    ).toBeVisible();
    expect(screen.getByTestId("active-toast-count")).toHaveTextContent("0");
  });

  it("rejects access outside its provider", () => {
    expect(() => render(<NotificationProbe />)).toThrow(
      new Error("useNotifications must be used within a NotificationProvider."),
    );
  });
});
